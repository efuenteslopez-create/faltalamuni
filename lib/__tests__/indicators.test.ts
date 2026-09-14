import { describe, it, expect, beforeEach } from "vitest";
import { transact, newId, nowIso } from "@/lib/db/store";
import { Report, ReportState, StatusEvent } from "@/lib/domain/types";
import { computeMetrics, METHODOLOGY } from "@/lib/indicators";
import { freshDb, makeUser } from "@/lib/__tests__/support";

beforeEach(() => {
  freshDb();
});

const T0 = Date.parse("2026-09-01T12:00:00.000Z");
const at = (hours: number): string =>
  new Date(T0 + hours * 3_600_000).toISOString();

interface FixtureEvent {
  to: ReportState;
  at: string;
  actorId: string | null;
  reason?: string;
}

async function fixtureReport(opts: {
  code: string;
  categoryId: string;
  state: ReportState;
  events: FixtureEvent[];
}): Promise<void> {
  await transact((db) => {
    const id = newId();
    const report: Report = {
      id,
      code: opts.code,
      municipalityId: "mun-i",
      categoryId: opts.categoryId,
      title: `Reporte ${opts.code}`,
      description: "Descripción de prueba.",
      location: { lng: -70.7, lat: -33.4 },
      publicLocation: { lng: -70.7, lat: -33.4 },
      state: opts.state,
      version: opts.events.length,
      authorId: "u1",
      anonymousPublic: false,
      responsibleOrgId: null,
      managingOrgId: null,
      executorOrgId: null,
      verifierId: null,
      confirmationsCount: 0,
      followersCount: 0,
      createdAt: opts.events[0]?.at ?? at(0),
      updatedAt: opts.events[opts.events.length - 1]?.at ?? at(0),
    };
    db.reports[id] = report as unknown as (typeof db.reports)[string];
    let prev: ReportState | null = null;
    for (const e of opts.events) {
      const sev: StatusEvent = {
        id: newId(),
        reportId: id,
        from: prev,
        to: e.to,
        actorId: e.actorId,
        reason: e.reason ?? null,
        idempotencyKey: null,
        createdAt: e.at,
      };
      db.statusEvents[sev.id] = sev as unknown as (typeof db.statusEvents)[string];
      prev = e.to;
    }
  });
}

async function setupFixtures() {
  await transact((db) => {
    db.municipalities["mun-i"] = {
      id: "mun-i",
      name: "Pudahuel",
      prefix: "PUD",
      center: { lng: -70.7449, lat: -33.4378 },
      createdAt: nowIso(),
    } as unknown as (typeof db.municipalities)[string];
    for (const [id, name] of [
      ["cat-a", "Basural"],
      ["cat-b", "Luminaria"],
    ] as const) {
      db.categories[id] = {
        id,
        slug: id,
        name,
        icon: "x",
        sensitiveLocation: false,
      } as unknown as (typeof db.categories)[string];
    }
    db.organizations["org-muni-i"] = {
      id: "org-muni-i",
      kind: "MUNICIPALITY",
      name: "Muni",
      shortName: "M",
      verified: true,
      municipalityId: "mun-i",
      createdAt: nowIso(),
    } as unknown as (typeof db.organizations)[string];
  });
  const u1 = await makeUser({ email: "u1@i.cl", displayName: "U1", role: "RESIDENT" });
  const u2 = await makeUser({ email: "u2@i.cl", displayName: "U2", role: "MUNICIPAL_AGENT" });
  const u3 = await makeUser({ email: "u3@i.cl", displayName: "U3", role: "RESIDENT" });
  await transact((db) => {
    const mid = newId();
    db.memberships[mid] = {
      id: mid,
      userId: u2.id,
      organizationId: "org-muni-i",
      role: "MUNICIPAL_AGENT",
      createdAt: nowIso(),
    } as unknown as (typeof db.memberships)[string];
  });
  const U1 = u1.id;
  const U2 = u2.id;
  const U3 = u3.id;

  await fixtureReport({
    code: "A", categoryId: "cat-a", state: "ACKNOWLEDGED",
    events: [
      { to: "REPORTED", at: at(0), actorId: U1 },
      { to: "AWAITING_RESPONSE", at: at(0), actorId: null },
      { to: "ACKNOWLEDGED", at: at(1), actorId: U2 },
    ],
  });
  await fixtureReport({
    code: "B", categoryId: "cat-a", state: "ACKNOWLEDGED",
    events: [
      { to: "REPORTED", at: at(0), actorId: U1 },
      { to: "AWAITING_RESPONSE", at: at(0), actorId: null },
      { to: "ACKNOWLEDGED", at: at(3), actorId: U2 },
    ],
  });
  await fixtureReport({
    code: "C", categoryId: "cat-b", state: "AWAITING_RESPONSE",
    events: [
      { to: "REPORTED", at: at(0), actorId: U1 },
      { to: "AWAITING_RESPONSE", at: at(0), actorId: null },
    ],
  });
  await fixtureReport({
    code: "D", categoryId: "cat-a", state: "VERIFIED_RESOLVED",
    events: [
      { to: "REPORTED", at: at(0), actorId: U1 },
      { to: "AWAITING_RESPONSE", at: at(0), actorId: null },
      { to: "ACKNOWLEDGED", at: at(1), actorId: U2 },
      { to: "TRIAGED", at: at(2), actorId: U2 },
      { to: "IN_PROGRESS", at: at(5), actorId: U2 },
      { to: "SOLUTION_PROPOSED", at: at(24), actorId: U2 },
      { to: "AWAITING_VERIFICATION", at: at(24), actorId: null },
      { to: "VERIFIED_RESOLVED", at: at(48), actorId: U1 },
    ],
  });
  await fixtureReport({
    code: "E", categoryId: "cat-b", state: "VERIFIED_RESOLVED",
    events: [
      { to: "REPORTED", at: at(0), actorId: U1 },
      { to: "AWAITING_RESPONSE", at: at(0), actorId: null },
      { to: "ACKNOWLEDGED", at: at(2), actorId: U3 },
      { to: "IN_PROGRESS", at: at(10), actorId: U3 },
      { to: "SOLUTION_PROPOSED", at: at(30), actorId: U3 },
      { to: "AWAITING_VERIFICATION", at: at(30), actorId: null },
      { to: "VERIFIED_RESOLVED", at: at(72), actorId: U1 },
    ],
  });
  await fixtureReport({
    code: "F", categoryId: "cat-a", state: "REOPENED",
    events: [
      { to: "REPORTED", at: at(0), actorId: U1 },
      { to: "AWAITING_RESPONSE", at: at(0), actorId: null },
      { to: "ACKNOWLEDGED", at: at(4), actorId: U2 },
      { to: "IN_PROGRESS", at: at(10), actorId: U2 },
      { to: "SOLUTION_PROPOSED", at: at(16), actorId: U2 },
      { to: "AWAITING_VERIFICATION", at: at(20), actorId: U2 },
      { to: "REOPENED", at: at(50), actorId: U1, reason: "Sigue igual" },
    ],
  });
  await fixtureReport({
    code: "G", categoryId: "cat-b", state: "REFERRED",
    events: [
      { to: "REPORTED", at: at(0), actorId: U1 },
      { to: "AWAITING_RESPONSE", at: at(0), actorId: null },
      { to: "TRIAGED", at: at(5), actorId: U2 },
      { to: "REFERRED", at: at(6), actorId: U2, reason: "Competencia externa" },
    ],
  });
  await fixtureReport({
    code: "H", categoryId: "cat-a", state: "HIDDEN_BY_MODERATION",
    events: [
      { to: "REPORTED", at: at(0), actorId: U1 },
      { to: "AWAITING_RESPONSE", at: at(0), actorId: null },
      { to: "HIDDEN_BY_MODERATION", at: at(1), actorId: U3, reason: "spam" },
    ],
  });
}

describe("indicadores calculados desde eventos", () => {
  it("calcula el set completo de métricas", async () => {
    await setupFixtures();
    const m = await computeMetrics("mun-i");

    expect(m.municipalityId).toBe("mun-i");
    expect(m.universe).toBe(7); // H (restringido) queda fuera
    expect(m.total).toBe(7);
    expect(m.respondedPct).toBeCloseTo(85.7, 1);
    expect(m.medianFirstResponseHours).toBe(2.5);
    expect(m.managementPct).toBeCloseTo(42.9, 1); // D, E, F
    expect(m.solutionInformedPct).toBeCloseTo(42.9, 1); // D, E, F
    expect(m.verifiedPct).toBeCloseTo(28.6, 1);
    expect(m.reopenedCount).toBe(1);
    expect(m.referredCount).toBe(1);
    expect(m.medianSolutionHours).toBe(60);
    expect(m.municipalSealCount).toBe(1); // solo D: "Ya estuvo la Muni"
    expect(m.resolvedWithoutMunicipalityCount).toBe(1); // E: "Problema resuelto"
  });

  it("desglosa por categoría", async () => {
    await setupFixtures();
    const m = await computeMetrics("mun-i");
    const a = m.byCategory.find((c) => c.categoryId === "cat-a");
    const b = m.byCategory.find((c) => c.categoryId === "cat-b");
    expect(a).toMatchObject({ total: 4, respondedPct: 100, verifiedPct: 25 });
    expect(b?.total).toBe(3);
    expect(b?.respondedPct).toBeCloseTo(66.7, 1);
    expect(b?.verifiedPct).toBeCloseTo(33.3, 1);
  });

  it("expone la metodología en texto", async () => {
    await setupFixtures();
    const m = await computeMetrics("mun-i");
    expect(m.methodology).toBe(METHODOLOGY);
    expect(METHODOLOGY).toContain("statusEvents");
    expect(METHODOLOGY).toContain("Ya estuvo la Muni");
  });

  it("comuna inexistente → MUNICIPALITY_NOT_FOUND", async () => {
    await setupFixtures();
    await expect(computeMetrics("mun-xxx")).rejects.toMatchObject({
      code: "MUNICIPALITY_NOT_FOUND",
    });
  });
});
