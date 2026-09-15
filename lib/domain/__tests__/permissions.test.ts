import { describe, it, expect, beforeEach } from "vitest";
import { read, transact, newId, nowIso } from "@/lib/db/store";
import { ROLES, AuditEvent } from "@/lib/domain/types";
import { assertTransition } from "@/lib/domain/state-machine";
import {
  canEditOriginalReport,
  hasCapability,
  inScope,
  Actor,
} from "@/lib/domain/permissions";
import {
  createReport,
  transitionReport,
  voteVerification,
  addEvidence,
  assignDepartment,
} from "@/lib/services/reports";
import {
  freshDb,
  makeUser,
  makeActor,
  expectCode,
  PNG_1PX,
} from "@/lib/__tests__/support";

beforeEach(() => {
  freshDb();
});

interface World {
  resident: Actor;
  agent: Actor;
  moderator: Actor;
  admin: Actor;
  categoryId: string;
  deptId: string;
}

async function setupWorld(): Promise<World> {
  await transact((db) => {
    db.municipalities["mun-p"] = {
      id: "mun-p",
      name: "Pudahuel",
      prefix: "P",
      center: { lng: -70.7, lat: -33.4 },
      createdAt: nowIso(),
    } as unknown as (typeof db.municipalities)[string];
    db.categories["cat-p"] = {
      id: "cat-p",
      slug: "basural",
      name: "Basural",
      icon: "trash",
      sensitiveLocation: false,
    } as unknown as (typeof db.categories)[string];
    db.organizations["org-m"] = {
      id: "org-m",
      kind: "MUNICIPALITY",
      name: "Muni",
      shortName: "M",
      verified: true,
      municipalityId: "mun-p",
      createdAt: nowIso(),
    } as unknown as (typeof db.organizations)[string];
    db.departments["dep-p"] = {
      id: "dep-p",
      name: "Aseo",
      municipalityId: "mun-p",
      organizationId: "org-m",
      createdAt: nowIso(),
    } as unknown as (typeof db.departments)[string];
  });
  const residentUser = await makeUser({
    email: "r@t.cl",
    displayName: "R",
    role: "RESIDENT",
  });
  const agentUser = await makeUser({
    email: "a@t.cl",
    displayName: "A",
    role: "MUNICIPAL_AGENT",
  });
  const moderatorUser = await makeUser({
    email: "m@t.cl",
    displayName: "M",
    role: "INDEPENDENT_MODERATOR",
  });
  const adminUser = await makeUser({
    email: "ad@t.cl",
    displayName: "AD",
    role: "PLATFORM_ADMIN",
  });
  await transact((db) => {
    const mid = newId();
    db.memberships[mid] = {
      id: mid,
      userId: agentUser.id,
      organizationId: "org-m",
      role: "MUNICIPAL_AGENT",
      createdAt: nowIso(),
    } as unknown as (typeof db.memberships)[string];
  });
  return {
    resident: makeActor(residentUser),
    agent: makeActor(agentUser, {
      organizationId: "org-m",
      municipalityIds: ["mun-p"],
    }),
    moderator: makeActor(moderatorUser),
    admin: makeActor(adminUser),
    categoryId: "cat-p",
    deptId: "dep-p",
  };
}

async function createSample(w: World) {
  return createReport(w.resident, {
    categoryId: w.categoryId,
    municipalityId: "mun-p",
    title: "Basural en la esquina",
    description: "Acumulación de basura hace semanas.",
    location: { lng: -70.7001, lat: -33.4001 },
  });
}

async function driveToVerification(w: World, code: string) {
  await transitionReport(w.agent, code, { to: "ACKNOWLEDGED", expectedVersion: 1 });
  await transitionReport(w.agent, code, { to: "TRIAGED", expectedVersion: 2 });
  await assignDepartment(w.agent, code, {
    departmentId: w.deptId,
    expectedVersion: 3,
  });
  await transitionReport(w.agent, code, { to: "IN_PROGRESS", expectedVersion: 4 });
  await addEvidence(w.agent, code, { dataUrl: PNG_1PX, kind: "solution" });
  await transitionReport(w.agent, code, {
    to: "SOLUTION_PROPOSED",
    expectedVersion: 5,
  });
  await transitionReport(w.agent, code, {
    to: "AWAITING_VERIFICATION",
    expectedVersion: 6,
  });
}

describe("matriz de permisos (spec §13)", () => {
  it("1. ningún funcionario edita el reporte original", () => {
    for (const role of ROLES) {
      expect(canEditOriginalReport(role)).toBe(false);
    }
  });

  it("2. el funcionario no verifica directamente", () => {
    expect(() =>
      assertTransition(
        "AWAITING_VERIFICATION",
        "VERIFIED_RESOLVED",
        "MUNICIPAL_AGENT"
      )
    ).toThrowError(expect.objectContaining({ code: "FORBIDDEN_TRANSITION" }));
  });

  it("2b. admin y moderador no tienen la capacidad de verificar (iteración 1)", () => {
    expect(hasCapability("PLATFORM_ADMIN", "report.verify")).toBe(false);
    expect(hasCapability("INDEPENDENT_MODERATOR", "report.verify")).toBe(false);
    for (const role of ["PLATFORM_ADMIN", "INDEPENDENT_MODERATOR"] as const) {
      expect(() =>
        assertTransition("AWAITING_VERIFICATION", "VERIFIED_RESOLVED", role)
      ).toThrowError(expect.objectContaining({ code: "FORBIDDEN_TRANSITION" }));
    }
    // Solo ciudadanía conserva la capacidad.
    expect(hasCapability("RESIDENT", "report.verify")).toBe(true);
    expect(hasCapability("VERIFIED_RESIDENT", "report.verify")).toBe(true);
  });

  it("3. el funcionario no opera fuera de su comuna", async () => {
    const w = await setupWorld();
    const dto = await createSample(w);
    const outsider = makeActor(
      await makeUser({
        email: "out@t.cl",
        displayName: "Out",
        role: "MUNICIPAL_AGENT",
      }),
      { organizationId: "org-m", municipalityIds: ["mun-otra"] }
    );
    expect(inScope(outsider, "mun-p")).toBe(false);
    await expectCode(
      transitionReport(outsider, dto.code, {
        to: "ACKNOWLEDGED",
        expectedVersion: 1,
      }),
      "SCOPE_FORBIDDEN"
    );
  });

  it("4. el ciudadano no suplanta a la institución", async () => {
    const w = await setupWorld();
    const dto = await createSample(w);
    expect(hasCapability("RESIDENT", "institutional.acknowledge")).toBe(false);
    await expectCode(
      transitionReport(w.resident, dto.code, {
        to: "ACKNOWLEDGED",
        expectedVersion: 1,
      }),
      "FORBIDDEN_TRANSITION"
    );
  });

  it("5. no hay doble voto en la verificación", async () => {
    const w = await setupWorld();
    const dto = await createSample(w);
    await driveToVerification(w, dto.code);
    await voteVerification(w.resident, dto.code, { approve: true });
    await expectCode(
      voteVerification(w.resident, dto.code, { approve: true }),
      "DUPLICATE_VOTE"
    );
  });

  it("6. la moderación siempre justifica", async () => {
    const w = await setupWorld();
    const dto = await createSample(w);
    await expectCode(
      transitionReport(w.moderator, dto.code, {
        to: "HIDDEN_BY_MODERATION",
        expectedVersion: 1,
      }),
      "REASON_REQUIRED"
    );
    const after = await transitionReport(w.moderator, dto.code, {
      to: "HIDDEN_BY_MODERATION",
      reason: "Contenido que vulnera las normas",
      expectedVersion: 1,
    });
    expect(after.state).toBe("HIDDEN_BY_MODERATION");
  });

  it("7. toda acción sensible deja rastro de auditoría", async () => {
    const w = await setupWorld();
    const dto = await createSample(w);
    await transitionReport(w.agent, dto.code, {
      to: "ACKNOWLEDGED",
      expectedVersion: 1,
    });
    const events = await read(
      (db) =>
        (Object.values(db.auditEvents) as unknown as AuditEvent[]).filter((e) =>
          e.action.startsWith("report.")
        )
    );
    const created = events.find((e) => e.action === "report.create");
    const transitioned = events.find((e) => e.action === "report.transition");
    expect(created?.actorId).toBe(w.resident.id);
    expect(transitioned?.actorId).toBe(w.agent.id);
    expect(transitioned?.detail["to"]).toBe("ACKNOWLEDGED");
  });

  it("8. el admin no altera el historial silenciosamente", async () => {
    const w = await setupWorld();
    const dto = await createSample(w);
    // El admin tampoco puede hacer gestión institucional encubierta
    await expectCode(
      transitionReport(w.admin, dto.code, {
        to: "ACKNOWLEDGED",
        expectedVersion: 1,
      }),
      "FORBIDDEN_TRANSITION"
    );
    expect(canEditOriginalReport("PLATFORM_ADMIN")).toBe(false);
    // Lo que sí puede hacer (moderar) queda auditado con su identidad
    await transitionReport(w.admin, dto.code, {
      to: "HIDDEN_BY_MODERATION",
      reason: "Duplicado malicioso",
      expectedVersion: 1,
    });
    const events = await read(
      (db) =>
        (Object.values(db.auditEvents) as unknown as AuditEvent[]).filter(
          (e) => e.action === "report.transition"
        )
    );
    expect(events.length).toBe(1);
    expect(events[0].actorId).toBe(w.admin.id);
    expect(events[0].detail["to"]).toBe("HIDDEN_BY_MODERATION");
  });
});
