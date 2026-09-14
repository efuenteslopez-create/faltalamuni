import { describe, it, expect, beforeEach } from "vitest";
import { transact, nowIso } from "@/lib/db/store";
import {
  getIdempotentResponse,
  saveIdempotentResponse,
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

describe("idempotencia", () => {
  it("guarda y recupera la respuesta original sin re-ejecutar", async () => {
    expect(await getIdempotentResponse("clave-inexistente")).toBeNull();
    const body = { ok: true, data: { code: "FLM-PUD-000001" } };
    await saveIdempotentResponse("clave-1", 201, body);
    const cached = await getIdempotentResponse("clave-1");
    expect(cached).toEqual({ statusCode: 201, body });
  });

  it("no sobrescribe una respuesta ya guardada", async () => {
    await saveIdempotentResponse("clave-2", 200, { ok: true, data: 1 });
    await saveIdempotentResponse("clave-2", 200, { ok: true, data: 2 });
    const cached = await getIdempotentResponse("clave-2");
    expect(cached?.body).toEqual({ ok: true, data: 1 });
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
