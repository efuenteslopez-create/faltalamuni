/**
 * FLM — Iteración 1 (auditoría): tests HTTP reales de los handlers de
 * respaldo municipal.
 *
 * Se invoca el `POST` real de cada ruta con un `NextRequest` (cookie de
 * sesión firmada) y se aserta el status y el cuerpo de la respuesta HTTP
 * verdadera:
 *
 * - POST /api/reports/[code]/public-references → 201 (municipalidad válida).
 * - POST /api/reports/[code]/referral-acceptances → 201 (agencia receptora).
 * - Una municipalidad no puede fabricar la aceptación de una agencia (403).
 * - Una agencia distinta no puede responder la derivación (403).
 * - Una referencia de otro reporte no puede respaldar una acción (400).
 * - Sin autenticar → 401; entradas inválidas → 400; duplicados → 409.
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
import { POST as refsPOST } from "@/app/api/reports/[code]/public-references/route";
import { POST as acceptPOST } from "@/app/api/reports/[code]/referral-acceptances/route";
import { POST as actionsPOST } from "@/app/api/reports/[code]/municipal-actions/route";
import {
  createReport,
  transitionReport,
  referToAgency,
} from "@/lib/services/reports";
import { Actor } from "@/lib/domain/permissions";
import { freshDb, makeUser, makeActor } from "@/lib/__tests__/support";

beforeEach(() => {
  freshDb();
});

interface World {
  code: string;
  code2: string;
  referralId: string;
  ana: Actor;
  paula: Actor;
  ext: Actor;
  ext2: Actor;
  camila: Actor;
  anaToken: string;
  paulaToken: string;
  extToken: string;
  ext2Token: string;
  camilaToken: string;
}

async function setupWorld(): Promise<World> {
  await transact((db) => {
    const t = (coll: CollectionName, doc: Doc) => {
      db[coll][doc.id] = doc;
    };
    t("municipalities", {
      id: "mun-t", name: "Pudahuel", prefix: "PUD",
      center: { lng: -70.7449, lat: -33.4378 }, createdAt: nowIso(),
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
    t("organizations", {
      id: "org-ext2", kind: "EXTERNAL_AGENCY", name: "Sanitaria Demo",
      shortName: "SD", verified: true, municipalityId: "mun-t", createdAt: nowIso(),
    });
    t("externalAgencies", {
      id: "ag-t", organizationId: "org-ext", name: "Eléctrica Demo",
      createdAt: nowIso(),
    });
    t("externalAgencies", {
      id: "ag-t2", organizationId: "org-ext2", name: "Sanitaria Demo",
      createdAt: nowIso(),
    });
  });

  const camilaU = await makeUser({ email: "camila@f.cl", displayName: "Camila", role: "RESIDENT" });
  const anaU = await makeUser({ email: "ana@f.cl", displayName: "Ana", role: "MUNICIPAL_AGENT" });
  const paulaU = await makeUser({ email: "paula@f.cl", displayName: "Paula", role: "MUNICIPAL_MANAGER" });
  const extU = await makeUser({ email: "ext@f.cl", displayName: "Externo", role: "EXTERNAL_AGENCY_AGENT" });
  const ext2U = await makeUser({ email: "ext2@f.cl", displayName: "Externo Dos", role: "EXTERNAL_AGENCY_AGENT" });
  await transact((db) => {
    const link = (userId: string, organizationId: string, role: string) => {
      const id = newId();
      db.memberships[id] = {
        id, userId, organizationId, role, createdAt: nowIso(),
      } as unknown as (typeof db.memberships)[string];
    };
    link(anaU.id, "org-t", "MUNICIPAL_AGENT");
    link(paulaU.id, "org-t", "MUNICIPAL_MANAGER");
    link(extU.id, "org-ext", "EXTERNAL_AGENCY_AGENT");
    link(ext2U.id, "org-ext2", "EXTERNAL_AGENCY_AGENT");
  });

  const ana = makeActor(anaU, { organizationId: "org-t", municipalityIds: ["mun-t"] });
  const paula = makeActor(paulaU, { organizationId: "org-t", municipalityIds: ["mun-t"] });
  const ext = makeActor(extU, { organizationId: "org-ext", municipalityIds: ["mun-t"] });
  const ext2 = makeActor(ext2U, { organizationId: "org-ext2", municipalityIds: ["mun-t"] });

  const mk = async (title: string) =>
    createReport(makeActor(camilaU), {
      categoryId: "cat-t",
      municipalityId: "mun-t",
      title,
      description: "Se acumula basura y escombros hace semanas.",
      location: { lng: -70.7489, lat: -33.4408 },
    });
  const r1 = await mk("Microbasural en sitio eriazo");
  const r2 = await mk("Microbasural en plaza");

  // Derivación a la agencia ag-t sobre el primer reporte (v4 tras la derivación).
  await transitionReport(ana, r1.code, { to: "ACKNOWLEDGED", expectedVersion: 1 });
  await transitionReport(ana, r1.code, { to: "TRIAGED", expectedVersion: 2 });
  await referToAgency(ana, r1.code, {
    agencyId: "ag-t",
    reason: "Competencia de la empresa eléctrica.",
    expectedVersion: 3,
  });

  const referralId = await read((db) =>
    (Object.values(db.referrals) as Array<{ id: string }>)[0].id
  );

  return {
    code: r1.code,
    code2: r2.code,
    referralId,
    ana,
    paula,
    ext,
    ext2,
    camila: makeActor(camilaU),
    anaToken: await createSession(anaU.id),
    paulaToken: await createSession(paulaU.id),
    extToken: await createSession(extU.id),
    ext2Token: await createSession(ext2U.id),
    camilaToken: await createSession(camilaU.id),
  };
}

function req(
  path: string,
  body: unknown,
  token?: string,
  extraHeaders: Record<string, string> = {}
): NextRequest {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...extraHeaders,
  };
  if (token) headers.cookie = `${SESSION_COOKIE}=${token}`;
  return new NextRequest(`http://localhost${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

describe("POST /api/reports/[code]/public-references (handler real)", () => {
  it("municipalidad válida registra una referencia → 201 real", async () => {
    const w = await setupWorld();
    const res = await refsPOST(
      req(`/api/reports/${w.code}/public-references`, {
        kind: "document",
        reference: "OF-2026-1187",
        summary: "Oficio de coordinación con empresa eléctrica.",
      }, w.paulaToken),
      { params: Promise.resolve({ code: w.code }) }
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { ok: boolean; data: { id: string; reference: string } };
    expect(body.ok).toBe(true);
    expect(body.data.id).toBeTruthy();
    expect(body.data.reference).toBe("OF-2026-1187");
  });

  it("sin autenticar → 401", async () => {
    const w = await setupWorld();
    const res = await refsPOST(
      req(`/api/reports/${w.code}/public-references`, {
        kind: "document", reference: "OF-1", summary: "Resumen válido aquí.",
      }),
      { params: Promise.resolve({ code: w.code }) }
    );
    expect(res.status).toBe(401);
  });

  it("residente no puede registrar referencias → 403", async () => {
    const w = await setupWorld();
    const res = await refsPOST(
      req(`/api/reports/${w.code}/public-references`, {
        kind: "document", reference: "OF-1", summary: "Resumen válido aquí.",
      }, w.camilaToken),
      { params: Promise.resolve({ code: w.code }) }
    );
    expect(res.status).toBe(403);
  });

  it("URL inválida → 400 real con VALIDATION", async () => {
    const w = await setupWorld();
    const res = await refsPOST(
      req(`/api/reports/${w.code}/public-references`, {
        kind: "url", reference: "nota interna sin protocolo", summary: "Resumen válido aquí.",
      }, w.paulaToken),
      { params: Promise.resolve({ code: w.code }) }
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("VALIDATION");
  });

  it("claves no permitidas (organizationId, actorId) → 400 por esquema estricto", async () => {
    const w = await setupWorld();
    const res = await refsPOST(
      req(`/api/reports/${w.code}/public-references`, {
        kind: "document", reference: "OF-1", summary: "Resumen válido aquí.",
        organizationId: "org-t", actorId: "x", accredited: true,
      }, w.paulaToken),
      { params: Promise.resolve({ code: w.code }) }
    );
    expect(res.status).toBe(400);
  });
});

describe("POST /api/reports/[code]/referral-acceptances (handler real)", () => {
  it("la agencia receptora registra su aceptación → 201 real", async () => {
    const w = await setupWorld();
    const res = await acceptPOST(
      req(`/api/reports/${w.code}/referral-acceptances`, {
        referralId: w.referralId,
        accepted: true,
        message: "Aceptamos la derivación; cuadrilla programada.",
      }, w.extToken),
      { params: Promise.resolve({ code: w.code }) }
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { ok: boolean; data: { accepted: boolean } };
    expect(body.ok).toBe(true);
    expect(body.data.accepted).toBe(true);
  });

  it("sin autenticar → 401", async () => {
    const w = await setupWorld();
    const res = await acceptPOST(
      req(`/api/reports/${w.code}/referral-acceptances`, {
        referralId: w.referralId, accepted: true, message: "Mensaje válido aquí.",
      }),
      { params: Promise.resolve({ code: w.code }) }
    );
    expect(res.status).toBe(401);
  });

  it("una municipalidad no puede fabricar la aceptación de una agencia → 403", async () => {
    const w = await setupWorld();
    const res = await acceptPOST(
      req(`/api/reports/${w.code}/referral-acceptances`, {
        referralId: w.referralId, accepted: true, message: "La muni finge ser la agencia.",
      }, w.paulaToken),
      { params: Promise.resolve({ code: w.code }) }
    );
    expect(res.status).toBe(403);
  });

  it("una agencia distinta no puede responder la derivación → 403", async () => {
    const w = await setupWorld();
    const res = await acceptPOST(
      req(`/api/reports/${w.code}/referral-acceptances`, {
        referralId: w.referralId, accepted: true, message: "Otra agencia intenta responder.",
      }, w.ext2Token),
      { params: Promise.resolve({ code: w.code }) }
    );
    expect(res.status).toBe(403);
  });

  it("derivación de otro reporte → 404 real con REFERRAL_NOT_FOUND", async () => {
    const w = await setupWorld();
    const res = await acceptPOST(
      req(`/api/reports/${w.code2}/referral-acceptances`, {
        referralId: w.referralId, accepted: true, message: "Mensaje válido aquí.",
      }, w.extToken),
      { params: Promise.resolve({ code: w.code2 }) }
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("REFERRAL_NOT_FOUND");
  });

  it("segunda aceptación a la misma derivación → 409 real con ALREADY_ANSWERED", async () => {
    const w = await setupWorld();
    const first = await acceptPOST(
      req(`/api/reports/${w.code}/referral-acceptances`, {
        referralId: w.referralId, accepted: true, message: "Aceptamos la derivación.",
      }, w.extToken),
      { params: Promise.resolve({ code: w.code }) }
    );
    expect(first.status).toBe(201);
    const second = await acceptPOST(
      req(`/api/reports/${w.code}/referral-acceptances`, {
        referralId: w.referralId, accepted: false, message: "Cambiamos de opinión.",
      }, w.extToken),
      { params: Promise.resolve({ code: w.code }) }
    );
    expect(second.status).toBe(409);
  });

  it("una referencia de otro reporte no puede respaldar una acción → 400 real", async () => {
    const w = await setupWorld();
    // Referencia registrada en el segundo reporte.
    const refRes = await refsPOST(
      req(`/api/reports/${w.code2}/public-references`, {
        kind: "document", reference: "OF-2026-9999", summary: "Referencia de otro reporte.",
      }, w.paulaToken),
      { params: Promise.resolve({ code: w.code2 }) }
    );
    expect(refRes.status).toBe(201);
    const refId = ((await refRes.json()) as { data: { id: string } }).data.id;
    // Intentar respaldar una acción del primer reporte con ella.
    const actRes = await actionsPOST(
      req(`/api/reports/${w.code}/municipal-actions`, {
        type: "EXTERNAL_COORDINATION_RECORDED",
        publicDescription: "Coordinación registrada con respaldo ajeno.",
        evidenceRef: refId,
      }, w.paulaToken),
      { params: Promise.resolve({ code: w.code }) }
    );
    expect(actRes.status).toBe(400);
    const body = (await actRes.json()) as { error: { code: string } };
    expect(body.error.code).toBe("BACKING_MISMATCH");
  });
});
