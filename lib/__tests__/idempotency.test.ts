import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { transact, nowIso } from "@/lib/db/store";
import {
  claimIdempotencyKey,
  completeIdempotencyKey,
  failIdempotencyKey,
  waitForIdempotencyResult,
  stableBodyHash,
  __setIdempotencyProcessingTtl,
  __resetIdempotencyProcessingTtl,
  type IdempotencyFingerprint,
} from "@/lib/idempotency";
import {
  createReport,
  transitionReport,
} from "@/lib/services/reports";
import { DomainError } from "@/lib/domain/types";
import {
  freshDb,
  makeUser,
  makeActor,
  expectCode,
} from "@/lib/__tests__/support";

beforeEach(() => {
  freshDb();
});

beforeEach(() => {
  freshDb();
});

afterEach(() => {
  __resetIdempotencyProcessingTtl();
});

const FP = (over: Partial<IdempotencyFingerprint> = {}): IdempotencyFingerprint => ({
  actorId: "user-1",
  method: "POST",
  route: "/api/reports",
  bodyHash: stableBodyHash({ a: 1 }),
  ...over,
});

describe("idempotencia concurrente", () => {
  it("primer claim es líder; segundo con la misma identidad espera", async () => {
    const c1 = await claimIdempotencyKey("k-1", FP());
    expect(c1.outcome).toBe("leader");
    const c2 = await claimIdempotencyKey("k-1", FP());
    expect(c2.outcome).toBe("wait");
  });

  it("completar permite replay con el mismo status/body sin re-ejecutar", async () => {
    const c1 = await claimIdempotencyKey("k-2", FP());
    expect(c1.outcome).toBe("leader");
    if (c1.outcome !== "leader") throw new Error("se esperaba líder");
    const body = { ok: true, data: { code: "FLM-PUD-000001" } };
    await completeIdempotencyKey("k-2", c1.claimId, 201, body);
    const replay = await claimIdempotencyKey("k-2", FP());
    expect(replay).toEqual({ outcome: "replay", statusCode: 201, body });
    // Un claim posterior con otra identidad sigue siendo conflicto.
    expect(await claimIdempotencyKey("k-2", FP({ actorId: "user-2" }))).toEqual({
      outcome: "conflict",
    });
  });

  it("distinta identidad (actor, método, ruta o body) → conflicto", async () => {
    const c1 = await claimIdempotencyKey("k-3", FP());
    expect(c1.outcome).toBe("leader");
    expect(await claimIdempotencyKey("k-3", FP({ actorId: "otro" }))).toEqual({
      outcome: "conflict",
    });
    expect(await claimIdempotencyKey("k-3", FP({ method: "DELETE" }))).toEqual({
      outcome: "conflict",
    });
    expect(await claimIdempotencyKey("k-3", FP({ route: "/api/otra" }))).toEqual({
      outcome: "conflict",
    });
    expect(
      await claimIdempotencyKey("k-3", FP({ bodyHash: stableBodyHash({ a: 2 }) }))
    ).toEqual({ outcome: "conflict" });
  });

  it("fallo libera la clave: el reintento con la misma identidad reclama", async () => {
    const c1 = await claimIdempotencyKey("k-4", FP());
    expect(c1.outcome).toBe("leader");
    if (c1.outcome !== "leader") throw new Error("se esperaba líder");
    await failIdempotencyKey("k-4", c1.claimId);
    const c2 = await claimIdempotencyKey("k-4", FP());
    expect(c2.outcome).toBe("leader");
  });

  it("PROCESSING abandonado (TTL) puede ser reclamado", async () => {
    __setIdempotencyProcessingTtl(30);
    const c1 = await claimIdempotencyKey("k-5", FP());
    expect(c1.outcome).toBe("leader");
    // El líder muere sin completar: tras el TTL la clave es reclamable.
    await new Promise((r) => setTimeout(r, 60));
    const c2 = await claimIdempotencyKey("k-5", FP());
    expect(c2.outcome).toBe("leader");
  });

  it("un líder obsoleto no pisa el reclamo nuevo (claimId)", async () => {
    __setIdempotencyProcessingTtl(30);
    const c1 = await claimIdempotencyKey("k-5", FP());
    if (c1.outcome !== "leader") throw new Error("se esperaba líder");
    await new Promise((r) => setTimeout(r, 60));
    const c2 = await claimIdempotencyKey("k-5", FP());
    expect(c2.outcome).toBe("leader");
    if (c2.outcome !== "leader") throw new Error("se esperaba líder");
    // El líder viejo intenta completar: se ignora.
    await completeIdempotencyKey("k-5", c1.claimId, 200, { ok: true });
    await completeIdempotencyKey("k-5", c2.claimId, 201, { ok: true, data: 1 });
    const replay = await claimIdempotencyKey("k-5", FP());
    expect(replay).toEqual({
      outcome: "replay",
      statusCode: 201,
      body: { ok: true, data: 1 },
    });
  });

  it("waiter recibe el resultado del líder sin re-ejecutar", async () => {
    const c1 = await claimIdempotencyKey("k-7", FP());
    if (c1.outcome !== "leader") throw new Error("se esperaba líder");
    const waiting = waitForIdempotencyResult("k-7");
    // El líder tarda un poco y completa.
    await new Promise((r) => setTimeout(r, 80));
    await completeIdempotencyKey("k-7", c1.claimId, 200, { ok: true, n: 7 });
    await expect(waiting).resolves.toEqual({
      statusCode: 200,
      body: { ok: true, n: 7 },
    });
  });

  it("waiter ve el fallo del líder como IDEMPOTENCY_UPSTREAM_FAILED", async () => {
    const c1 = await claimIdempotencyKey("k-8", FP());
    if (c1.outcome !== "leader") throw new Error("se esperaba líder");
    const waiting = waitForIdempotencyResult("k-8");
    await failIdempotencyKey("k-8", c1.claimId);
    await expect(waiting).rejects.toMatchObject({
      code: "IDEMPOTENCY_UPSTREAM_FAILED",
    });
  });

  it("stableBodyHash es independiente del orden de claves", () => {
    expect(stableBodyHash({ a: 1, b: { x: 1, y: 2 } })).toBe(
      stableBodyHash({ b: { y: 2, x: 1 }, a: 1 })
    );
    expect(stableBodyHash({ a: 1 })).not.toBe(stableBodyHash({ a: 2 }));
  });
});

describe("concurrencia optimista", () => {
  it("dos transiciones con el mismo expectedVersion: una gana, la otra VERSION_CONFLICT", async () => {
    await transact((db) => {
      db.municipalities["mun-c"] = {
        id: "mun-c",
        name: "C",
        prefix: "C",
        center: { lng: 0, lat: 0 },
        createdAt: nowIso(),
      } as unknown as (typeof db.municipalities)[string];
      db.categories["cat-c"] = {
        id: "cat-c",
        slug: "c",
        name: "C",
        icon: "c",
        sensitiveLocation: false,
      } as unknown as (typeof db.categories)[string];
    });
    const residentUser = await makeUser({
      email: "r@c.cl",
      displayName: "R",
      role: "RESIDENT",
    });
    const agentUser = await makeUser({
      email: "a@c.cl",
      displayName: "A",
      role: "MUNICIPAL_AGENT",
    });
    const resident = makeActor(residentUser);
    const agent = makeActor(agentUser, {
      organizationId: "org-c",
      municipalityIds: ["mun-c"],
    });

    const dto = await createReport(resident, {
      categoryId: "cat-c",
      municipalityId: "mun-c",
      title: "Reporte concurrente",
      description: "Descripción suficientemente larga.",
      location: { lng: 0.001, lat: 0.001 },
    });
    expect(dto.version).toBe(1);

    // Dos intentos "simultáneos" con la misma versión esperada.
    const results = await Promise.allSettled([
      transitionReport(agent, dto.code, {
        to: "ACKNOWLEDGED",
        expectedVersion: 1,
      }),
      transitionReport(agent, dto.code, {
        to: "TRIAGED",
        expectedVersion: 1,
      }),
    ]);

    const okCount = results.filter((r) => r.status === "fulfilled").length;
    const conflicts = results.filter(
      (r) =>
        r.status === "rejected" &&
        (r.reason as DomainError).code === "VERSION_CONFLICT"
    );
    expect(okCount).toBe(1);
    expect(conflicts.length).toBe(1);
  });

  it("reintentar con la versión fresca sí funciona", async () => {
    await transact((db) => {
      db.municipalities["mun-c2"] = {
        id: "mun-c2",
        name: "C2",
        prefix: "C2",
        center: { lng: 0, lat: 0 },
        createdAt: nowIso(),
      } as unknown as (typeof db.municipalities)[string];
      db.categories["cat-c2"] = {
        id: "cat-c2",
        slug: "c2",
        name: "C2",
        icon: "c2",
        sensitiveLocation: false,
      } as unknown as (typeof db.categories)[string];
    });
    const resident = makeActor(
      await makeUser({ email: "r2@c.cl", displayName: "R2", role: "RESIDENT" })
    );
    const agent = makeActor(
      await makeUser({
        email: "a2@c.cl",
        displayName: "A2",
        role: "MUNICIPAL_AGENT",
      }),
      { organizationId: "org-c2", municipalityIds: ["mun-c2"] }
    );
    const dto = await createReport(resident, {
      categoryId: "cat-c2",
      municipalityId: "mun-c2",
      title: "Reporte con reintento",
      description: "Descripción suficientemente larga.",
      location: { lng: 0.001, lat: 0.001 },
    });
    await expectCode(
      transitionReport(agent, dto.code, { to: "ACKNOWLEDGED", expectedVersion: 99 }),
      "VERSION_CONFLICT"
    );
    const after = await transitionReport(agent, dto.code, {
      to: "ACKNOWLEDGED",
      expectedVersion: 1,
    });
    expect(after.version).toBe(2);
    expect(after.state).toBe("ACKNOWLEDGED");
  });
});
