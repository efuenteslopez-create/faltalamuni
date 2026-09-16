/**
 * FLM — Iteración 2: idempotencia concurrente a nivel HTTP.
 *
 * Se invocan los handlers reales con NextRequest (cookie de sesión firmada)
 * y `Idempotency-Key`:
 * - 10 peticiones concurrentes con la misma identidad → UN solo efecto y las
 *   10 reciben el mismo status/body.
 * - Replay secuencial con la misma clave → misma respuesta, sin re-ejecutar.
 * - Misma clave con distinto body/actor → 409 IDEMPOTENCY_CONFLICT.
 * - Sin clave → cada envío ejecuta (la clave es lo que desduplica).
 *
 * Casos: creación de reportes, confirmaciones, votos de verificación,
 * acciones municipales y aceptaciones de derivación.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import {
  read,
  transact,
  newId,
  nowIso,
  CollectionName,
  Doc,
} from "@/lib/db/store";
import { SESSION_COOKIE, createSession } from "@/lib/auth/auth";
import { __resetRateLimits } from "@/lib/rate-limit";
import { POST as reportsPOST } from "@/app/api/reports/route";
import { POST as confirmPOST } from "@/app/api/reports/[code]/confirm/route";
import { POST as votesPOST } from "@/app/api/reports/[code]/verification-votes/route";
import { POST as actionsPOST } from "@/app/api/reports/[code]/municipal-actions/route";
import { POST as acceptPOST } from "@/app/api/reports/[code]/referral-acceptances/route";
import {
  createReport,
  transitionReport,
  assignDepartment,
  addEvidence,
  referToAgency,
} from "@/lib/services/reports";
import { Actor } from "@/lib/domain/permissions";
import {
  freshDb,
  makeUser,
  makeActor,
  PNG_1PX,
} from "@/lib/__tests__/support";

beforeEach(() => {
  freshDb();
  __resetRateLimits();
});

interface World {
  camila: Actor;
  jorge: Actor;
  ana: Actor;
  ext: Actor;
  camilaToken: string;
  jorgeToken: string;
  anaToken: string;
  extToken: string;
  code: string;
}

async function setupWorld(): Promise<World> {
  await transact((db) => {
    const t = (coll: CollectionName, doc: Doc) => {
      db[coll][doc.id] = doc;
    };
    t("municipalities", {
      id: "mun-t", name: "Pudahuel", prefix: "PUD",
      center: { lng: -70.7449, lat: -33.4408 }, createdAt: nowIso(),
    });
    t("categories", {
      id: "cat-t", slug: "basural", name: "Basural",
      icon: "trash", sensitiveLocation: false,
    });
    t("organizations", {
      id: "org-t", kind: "MUNICIPALITY", name: "Muni Pudahuel",
      shortName: "MP", verified: true, municipalityId: "mun-t", createdAt: nowIso(),
    });
    t("organizations", {
      id: "org-ext", kind: "EXTERNAL_AGENCY", name: "Eléctrica Demo",
      shortName: "ED", verified: true, municipalityId: "mun-t", createdAt: nowIso(),
    });
    t("externalAgencies", {
      id: "ag-t", organizationId: "org-ext", name: "Eléctrica Demo",
      createdAt: nowIso(),
    });
    t("departments", {
      id: "dep-t", name: "Aseo y Ornato", municipalityId: "mun-t",
      organizationId: "org-t", createdAt: nowIso(),
    });
  });

  const camilaU = await makeUser({ email: "camila@f.cl", displayName: "Camila", role: "RESIDENT" });
  const jorgeU = await makeUser({
    email: "jorge@f.cl", displayName: "Jorge",
    role: "VERIFIED_RESIDENT", verifiedResident: true,
  });
  const anaU = await makeUser({ email: "ana@f.cl", displayName: "Ana", role: "MUNICIPAL_AGENT" });
  const extU = await makeUser({ email: "ext@f.cl", displayName: "Externo", role: "EXTERNAL_AGENCY_AGENT" });
  await transact((db) => {
    const link = (userId: string, organizationId: string, role: string) => {
      const id = newId();
      db.memberships[id] = {
        id, userId, organizationId, role, createdAt: nowIso(),
      } as unknown as (typeof db.memberships)[string];
    };
    link(anaU.id, "org-t", "MUNICIPAL_AGENT");
    link(extU.id, "org-ext", "EXTERNAL_AGENCY_AGENT");
  });

  const camila = makeActor(camilaU);
  const ana = makeActor(anaU, { organizationId: "org-t", municipalityIds: ["mun-t"] });
  const dto = await createReport(camila, {
    categoryId: "cat-t",
    municipalityId: "mun-t",
    title: "Microbasural en sitio eriazo",
    description: "Se acumula basura y escombros hace semanas.",
    location: { lng: -70.7489, lat: -33.4408 },
  });

  return {
    camila,
    jorge: makeActor(jorgeU),
    ana,
    ext: makeActor(extU, { organizationId: "org-ext", municipalityIds: ["mun-t"] }),
    camilaToken: await createSession(camilaU.id),
    jorgeToken: await createSession(jorgeU.id),
    anaToken: await createSession(anaU.id),
    extToken: await createSession(extU.id),
    code: dto.code,
  };
}

function req(
  path: string,
  body: unknown,
  token?: string,
  key?: string,
  method = "POST"
): NextRequest {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers.cookie = `${SESSION_COOKIE}=${token}`;
  if (key) headers["Idempotency-Key"] = key;
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers,
    body: JSON.stringify(body),
  });
}

const paramsOf = (code: string) => ({ params: Promise.resolve({ code }) });

async function countIn(coll: CollectionName): Promise<number> {
  return read((db) => Object.keys(db[coll]).length);
}

const REPORT_BODY = {
  categoryId: "cat-t",
  municipalityId: "mun-t",
  title: "Basural duplicado por reintento",
  description: "Descripción suficientemente larga para validar.",
  location: { lng: -70.7489, lat: -33.4408 },
};

describe("idempotencia concurrente (handlers reales)", () => {
  it("10 POST /api/reports concurrentes con la misma clave → 1 solo reporte", async () => {
    const w = await setupWorld();
    const key = newId();
    const before = await countIn("reports");
    const responses = await Promise.all(
      Array.from({ length: 10 }, () =>
        reportsPOST(req("/api/reports", REPORT_BODY, w.camilaToken, key)).then(
          async (res) => ({ status: res.status, body: await res.json() })
        )
      )
    );
    for (const r of responses) {
      expect(r.status).toBe(201);
      expect(r.body.ok).toBe(true);
    }
    // Las 10 reciben exactamente el mismo cuerpo.
    for (const r of responses.slice(1)) {
      expect(r.body).toEqual(responses[0].body);
    }
    expect(await countIn("reports")).toBe(before + 1);
  });

  it("replay secuencial: misma clave → misma respuesta, sin re-ejecutar", async () => {
    const w = await setupWorld();
    const key = newId();
    const first = await reportsPOST(req("/api/reports", REPORT_BODY, w.camilaToken, key));
    expect(first.status).toBe(201);
    const firstBody = await first.json();
    const before = await countIn("reports");
    const second = await reportsPOST(req("/api/reports", REPORT_BODY, w.camilaToken, key));
    expect(second.status).toBe(201);
    expect(await second.json()).toEqual(firstBody);
    expect(await countIn("reports")).toBe(before);
  });

  it("misma clave + distinto body → 409 IDEMPOTENCY_CONFLICT (no ejecuta)", async () => {
    const w = await setupWorld();
    const key = newId();
    const first = await reportsPOST(req("/api/reports", REPORT_BODY, w.camilaToken, key));
    expect(first.status).toBe(201);
    const before = await countIn("reports");
    const other = { ...REPORT_BODY, title: "Otro título distinto" };
    const res = await reportsPOST(req("/api/reports", other, w.camilaToken, key));
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("IDEMPOTENCY_CONFLICT");
    expect(await countIn("reports")).toBe(before);
  });

  it("misma clave + distinto actor → 409 IDEMPOTENCY_CONFLICT", async () => {
    const w = await setupWorld();
    const key = newId();
    const first = await reportsPOST(req("/api/reports", REPORT_BODY, w.camilaToken, key));
    expect(first.status).toBe(201);
    const res = await reportsPOST(req("/api/reports", REPORT_BODY, w.jorgeToken, key));
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("IDEMPOTENCY_CONFLICT");
  });

  it("sin clave: dos envíos idénticos ejecutan dos veces", async () => {
    const w = await setupWorld();
    const before = await countIn("reports");
    const r1 = await reportsPOST(req("/api/reports", REPORT_BODY, w.camilaToken));
    const r2 = await reportsPOST(req("/api/reports", REPORT_BODY, w.camilaToken));
    expect(r1.status).toBe(201);
    expect(r2.status).toBe(201);
    expect(await countIn("reports")).toBe(before + 2);
  });

  it("10 confirms concurrentes con la misma clave → 1 sola confirmación", async () => {
    const w = await setupWorld();
    const key = newId();
    const responses = await Promise.all(
      Array.from({ length: 10 }, () =>
        confirmPOST(
          req(`/api/reports/${w.code}/confirm`, {}, w.jorgeToken, key),
          paramsOf(w.code)
        ).then(async (res) => ({ status: res.status, body: await res.json() }))
      )
    );
    for (const r of responses) {
      expect(r.status).toBe(200);
      expect(r.body.ok).toBe(true);
    }
    for (const r of responses.slice(1)) {
      expect(r.body).toEqual(responses[0].body);
    }
    expect(await countIn("confirmations")).toBe(1);
  });

  it("10 votos concurrentes con la misma clave → 1 solo voto", async () => {
    const w = await setupWorld();
    // Camino institucional hasta AWAITING_VERIFICATION (abre la ronda).
    let v = 1;
    await transitionReport(w.ana, w.code, { to: "ACKNOWLEDGED", expectedVersion: v++ });
    await transitionReport(w.ana, w.code, { to: "TRIAGED", expectedVersion: v++ });
    await assignDepartment(w.ana, w.code, { departmentId: "dep-t", expectedVersion: v++ });
    await transitionReport(w.ana, w.code, { to: "IN_PROGRESS", expectedVersion: v++ });
    await addEvidence(w.ana, w.code, { dataUrl: PNG_1PX, kind: "solution" });
    await transitionReport(w.ana, w.code, { to: "SOLUTION_PROPOSED", expectedVersion: v++ });
    await transitionReport(w.ana, w.code, { to: "AWAITING_VERIFICATION", expectedVersion: v++ });

    const key = newId();
    const voteBody = { approve: true, comment: "Verificado en terreno." };
    const responses = await Promise.all(
      Array.from({ length: 10 }, () =>
        votesPOST(
          req(`/api/reports/${w.code}/verification-votes`, voteBody, w.jorgeToken, key),
          paramsOf(w.code)
        ).then(async (res) => ({ status: res.status, body: await res.json() }))
      )
    );
    for (const r of responses) {
      expect(r.status).toBe(200);
      expect(r.body.ok).toBe(true);
    }
    for (const r of responses.slice(1)) {
      expect(r.body).toEqual(responses[0].body);
    }
    expect(await countIn("verificationVotes")).toBe(1);
  });

  it("10 acciones municipales concurrentes con la misma clave → 1 sola acción", async () => {
    const w = await setupWorld();
    const ev = await addEvidence(w.ana, w.code, { dataUrl: PNG_1PX, kind: "solution" });
    const key = newId();
    const actionBody = {
      type: "FIELD_WORK_RECORDED",
      publicDescription: "Cuadrilla municipal realizó el retiro.",
      evidenceRef: ev.id,
    };
    const responses = await Promise.all(
      Array.from({ length: 10 }, () =>
        actionsPOST(
          req(`/api/reports/${w.code}/municipal-actions`, actionBody, w.anaToken, key),
          paramsOf(w.code)
        ).then(async (res) => ({ status: res.status, body: await res.json() }))
      )
    );
    for (const r of responses) {
      expect(r.status).toBe(201);
      expect(r.body.ok).toBe(true);
    }
    for (const r of responses.slice(1)) {
      expect(r.body).toEqual(responses[0].body);
    }
    expect(await countIn("municipalActions")).toBe(1);
  });

  it("10 aceptaciones concurrentes con la misma clave → 1 sola aceptación", async () => {
    const w = await setupWorld();
    let v = 1;
    await transitionReport(w.ana, w.code, { to: "ACKNOWLEDGED", expectedVersion: v++ });
    await transitionReport(w.ana, w.code, { to: "TRIAGED", expectedVersion: v++ });
    await referToAgency(w.ana, w.code, {
      agencyId: "ag-t",
      reason: "Competencia de la empresa eléctrica.",
      expectedVersion: v++,
    });
    const referralId = await read(
      (db) => (Object.values(db.referrals) as Array<{ id: string }>)[0].id
    );

    const key = newId();
    const acceptBody = {
      referralId,
      accepted: true,
      message: "Aceptamos la derivación y programamos visita.",
    };
    const responses = await Promise.all(
      Array.from({ length: 10 }, () =>
        acceptPOST(
          req(`/api/reports/${w.code}/referral-acceptances`, acceptBody, w.extToken, key),
          paramsOf(w.code)
        ).then(async (res) => ({ status: res.status, body: await res.json() }))
      )
    );
    for (const r of responses) {
      expect(r.status).toBe(201);
      expect(r.body.ok).toBe(true);
    }
    for (const r of responses.slice(1)) {
      expect(r.body).toEqual(responses[0].body);
    }
    expect(await countIn("referralAcceptances")).toBe(1);
  });
});
