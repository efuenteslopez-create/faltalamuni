/**
 * FLM — Iteración 1 (auditoría, hallazgo 4): tests HTTP reales del handler
 * de transiciones (y del endpoint de acciones municipales).
 *
 * No se llama a `transitionReport` + `mapError` manualmente: se invoca el
 * `POST` real de la ruta con un `NextRequest` (con cookie de sesión firmada)
 * y se aserta el status y el cuerpo de la respuesta HTTP verdadera.
 *
 * - Autenticado pidiendo VERIFIED_RESOLVED → 403 (antes: 400 de Zod).
 * - Sin autenticar → 401.
 * - El rol/SYSTEM jamás se puede fabricar desde JSON, headers o params.
 * - El servicio mantiene su barrera defensiva (ya cubierta a nivel servicio).
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
import { POST as transitionsPOST } from "@/app/api/reports/[code]/transitions/route";
import { POST as actionsPOST } from "@/app/api/reports/[code]/municipal-actions/route";
import { createReport, addEvidence } from "@/lib/services/reports";
import { Actor } from "@/lib/domain/permissions";
import {
  freshDb,
  makeUser,
  makeActor,
  PNG_1PX,
} from "@/lib/__tests__/support";

beforeEach(() => {
  freshDb();
});

interface World {
  admin: Actor;
  marta: Actor; // INDEPENDENT_MODERATOR
  ana: Actor; // MUNICIPAL_AGENT org-t
  adminToken: string;
  martaToken: string;
  anaToken: string;
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
  });

  const adminU = await makeUser({ email: "admin@f.cl", displayName: "Admin", role: "PLATFORM_ADMIN" });
  const martaU = await makeUser({ email: "marta@f.cl", displayName: "Marta", role: "INDEPENDENT_MODERATOR" });
  const anaU = await makeUser({ email: "ana@f.cl", displayName: "Ana", role: "MUNICIPAL_AGENT" });
  await transact((db) => {
    const id = newId();
    db.memberships[id] = {
      id, userId: anaU.id, organizationId: "org-t",
      role: "MUNICIPAL_AGENT", createdAt: nowIso(),
    } as unknown as (typeof db.memberships)[string];
  });

  const authorU = await makeUser({ email: "camila@f.cl", displayName: "Camila", role: "RESIDENT" });
  await createReport(makeActor(authorU), {
    categoryId: "cat-t",
    municipalityId: "mun-t",
    title: "Microbasural en sitio eriazo",
    description: "Se acumula basura y escombros hace semanas.",
    location: { lng: -70.7489, lat: -33.4408 },
  });

  return {
    admin: makeActor(adminU),
    marta: makeActor(martaU),
    ana: makeActor(anaU, { organizationId: "org-t", municipalityIds: ["mun-t"] }),
    adminToken: await createSession(adminU.id),
    martaToken: await createSession(martaU.id),
    anaToken: await createSession(anaU.id),
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

async function firstCode(): Promise<string> {
  return read((db) => {
    const reports = Object.values(db.reports) as unknown as Array<{ code: string }>;
    return reports[0].code;
  });
}

async function stateOf(code: string): Promise<string> {
  return read((db) => {
    const r = Object.values(db.reports).find(
      (x) => (x as unknown as { code: string }).code === code
    ) as unknown as { state: string };
    return r.state;
  });
}

describe("POST /api/reports/[code]/transitions (handler real)", () => {
  it("sin autenticar → 401", async () => {
    await setupWorld();
    const code = await firstCode();
    const res = await transitionsPOST(
      req(`/api/reports/${code}/transitions`, { to: "ACKNOWLEDGED", expectedVersion: 1 }),
      { params: Promise.resolve({ code }) }
    );
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("UNAUTHENTICATED");
  });

  it("admin autenticado pide VERIFIED_RESOLVED → 403 real (no 400 de Zod)", async () => {
    const w = await setupWorld();
    const code = await firstCode();
    const res = await transitionsPOST(
      req(
        `/api/reports/${code}/transitions`,
        { to: "VERIFIED_RESOLVED", expectedVersion: 1 },
        w.adminToken
      ),
      { params: Promise.resolve({ code }) }
    );
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("FORBIDDEN");
    // El estado no cambió: nadie verificó nada.
    expect(await stateOf(code)).toBe("AWAITING_RESPONSE");
  });

  it("moderador autenticado pide VERIFIED_RESOLVED → 403 real", async () => {
    const w = await setupWorld();
    const code = await firstCode();
    const res = await transitionsPOST(
      req(
        `/api/reports/${code}/transitions`,
        { to: "VERIFIED_RESOLVED", expectedVersion: 1 },
        w.martaToken
      ),
      { params: Promise.resolve({ code }) }
    );
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("FORBIDDEN");
    expect(await stateOf(code)).toBe("AWAITING_RESPONSE");
  });

  it("funcionario pide VERIFIED_RESOLVED → 403 real", async () => {
    const w = await setupWorld();
    const code = await firstCode();
    const res = await transitionsPOST(
      req(
        `/api/reports/${code}/transitions`,
        { to: "VERIFIED_RESOLVED", expectedVersion: 1 },
        w.anaToken
      ),
      { params: Promise.resolve({ code }) }
    );
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("FORBIDDEN");
  });

  it("no se puede fabricar un actor SYSTEM desde JSON, headers o params", async () => {
    const w = await setupWorld();
    const code = await firstCode();
    const res = await transitionsPOST(
      req(
        `/api/reports/${code}/transitions`,
        {
          to: "VERIFIED_RESOLVED",
          role: "SYSTEM",
          actorRole: "SYSTEM",
          actorId: null,
        },
        w.adminToken,
        { "x-actor-role": "SYSTEM", "x-role": "SYSTEM" }
      ),
      { params: Promise.resolve({ code }) }
    );
    // Sigue siendo 403: el cuerpo y los headers no deciden el actor.
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("FORBIDDEN");
    const resolvedEvents = await read((db) =>
      Object.values(db.statusEvents).filter(
        (e) => (e as unknown as { to: string }).to === "VERIFIED_RESOLVED"
      )
    );
    expect(resolvedEvents).toHaveLength(0);
    expect(await stateOf(code)).toBe("AWAITING_RESPONSE");
  });

  it("una transición válida sigue funcionando por HTTP (200)", async () => {
    const w = await setupWorld();
    const code = await firstCode();
    const res = await transitionsPOST(
      req(
        `/api/reports/${code}/transitions`,
        {
          to: "HIDDEN_BY_MODERATION",
          reason: "Contenido de prueba para moderación.",
          expectedVersion: 1,
        },
        w.adminToken
      ),
      { params: Promise.resolve({ code }) }
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.state).toBe("HIDDEN_BY_MODERATION");
  });

  it("un valor de estado realmente desconocido sigue siendo 400", async () => {
    const w = await setupWorld();
    const code = await firstCode();
    const res = await transitionsPOST(
      req(
        `/api/reports/${code}/transitions`,
        { to: "ESTADO_INVENTADO", expectedVersion: 1 },
        w.adminToken
      ),
      { params: Promise.resolve({ code }) }
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("VALIDATION");
  });
});

describe("POST /api/reports/[code]/municipal-actions (handler real)", () => {
  it("acción física sin respaldo → 400 real con BACKING_REQUIRED", async () => {
    const w = await setupWorld();
    const code = await firstCode();
    const res = await actionsPOST(
      req(
        `/api/reports/${code}/municipal-actions`,
        { type: "FIELD_WORK_RECORDED", publicDescription: "Listo" },
        w.anaToken
      ),
      { params: Promise.resolve({ code }) }
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("BACKING_REQUIRED");
  });

  it("acción con respaldo válido → 201 real", async () => {
    const w = await setupWorld();
    const code = await firstCode();
    const ev = await addEvidence(w.ana, code, {
      dataUrl: PNG_1PX,
      kind: "solution",
    });
    const res = await actionsPOST(
      req(
        `/api/reports/${code}/municipal-actions`,
        {
          type: "FIELD_WORK_RECORDED",
          publicDescription: "Cuadrilla municipal realizó el retiro.",
          evidenceRef: ev.id,
        },
        w.anaToken
      ),
      { params: Promise.resolve({ code }) }
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.accredited).toBe(true);
    expect(body.data.evidenceRef).toBe(ev.id);
  });

  it("sin autenticar → 401", async () => {
    await setupWorld();
    const code = await firstCode();
    const res = await actionsPOST(
      req(`/api/reports/${code}/municipal-actions`, {
        type: "FIELD_WORK_RECORDED",
        publicDescription: "Listo",
      }),
      { params: Promise.resolve({ code }) }
    );
    expect(res.status).toBe(401);
  });
});
