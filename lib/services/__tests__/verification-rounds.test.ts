/**
 * FLM — Iteración 1 (auditoría): rondas de verificación.
 *
 * Los votos pertenecen a una VerificationRequest (ronda), no al reporte:
 * - Cada entrada a AWAITING_VERIFICATION abre una ronda nueva; nunca hay
 *   más de una abierta por reporte.
 * - voteVerification registra el voto en LA ronda abierta y evalúa el
 *   quórum solo con votos de esa ronda.
 * - Unicidad: voterId + verificationRequestId (se puede votar una vez por
 *   ronda; votar en una ronda anterior no impide votar en la nueva).
 * - Al resolver (SYSTEM, misma transacción) o reabrir, la ronda se cierra
 *   atómicamente.
 *
 * Casos: a) resolver → reabrir → segunda ronda; b) votos de la ronda 1 no
 * resuelven la ronda 2; c) primer voto de la ronda 2 no auto-resuelve;
 * d) un voto por ronda; e) sin voto doble en la misma ronda;
 * f) dos votos concurrentes → una sola resolución y una sola ronda cerrada.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  read,
  transact,
  newId,
  nowIso,
  CollectionName,
  Doc,
} from "@/lib/db/store";
import {
  createReport,
  transitionReport,
  voteVerification,
  addEvidence,
  assignDepartment,
  recordMunicipalAction,
  getReportByCode,
} from "@/lib/services/reports";
import { Actor } from "@/lib/domain/permissions";
import {
  VerificationRequest,
  VerificationVote,
} from "@/lib/domain/entities";
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
  camila: Actor; // RESIDENT, autora
  jorge: Actor; // VERIFIED_RESIDENT
  lucia: Actor; // VERIFIED_RESIDENT
  diego: Actor; // VERIFIED_RESIDENT
  ana: Actor; // MUNICIPAL_AGENT org-t
  categoryId: string;
  deptId: string;
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
    t("departments", {
      id: "dep-t", name: "Aseo y Ornato", municipalityId: "mun-t",
      organizationId: "org-t", createdAt: nowIso(),
    });
  });

  const camilaU = await makeUser({ email: "camila@f.cl", displayName: "Camila", role: "RESIDENT" });
  const jorgeU = await makeUser({ email: "jorge@f.cl", displayName: "Jorge", role: "VERIFIED_RESIDENT", verifiedResident: true });
  const luciaU = await makeUser({ email: "lucia@f.cl", displayName: "Lucía", role: "VERIFIED_RESIDENT", verifiedResident: true });
  const diegoU = await makeUser({ email: "diego@f.cl", displayName: "Diego", role: "VERIFIED_RESIDENT", verifiedResident: true });
  const anaU = await makeUser({ email: "ana@f.cl", displayName: "Ana", role: "MUNICIPAL_AGENT" });

  await transact((db) => {
    const id = newId();
    db.memberships[id] = {
      id, userId: anaU.id, organizationId: "org-t",
      role: "MUNICIPAL_AGENT", createdAt: nowIso(),
    } as unknown as (typeof db.memberships)[string];
  });

  return {
    camila: makeActor(camilaU),
    jorge: makeActor(jorgeU),
    lucia: makeActor(luciaU),
    diego: makeActor(diegoU),
    ana: makeActor(anaU, { organizationId: "org-t", municipalityIds: ["mun-t"] }),
    categoryId: "cat-t",
    deptId: "dep-t",
  };
}

const LOC = { lng: -70.7489, lat: -33.4408 };

async function createBasural(w: World) {
  return createReport(w.camila, {
    categoryId: w.categoryId,
    municipalityId: "mun-t",
    title: "Microbasural en sitio eriazo",
    description: "Se acumula basura y escombros hace semanas.",
    location: LOC,
  });
}

/** Camino institucional hasta AWAITING_VERIFICATION (abre una ronda).
 *  Tras una REOPENED el camino parte en TRIAGED (sin ACKNOWLEDGED). */
async function driveToVerification(
  w: World,
  code: string,
  version: number,
  afterReopen = false
) {
  let v = version;
  if (!afterReopen) {
    await transitionReport(w.ana, code, { to: "ACKNOWLEDGED", expectedVersion: v });
    v++;
  }
  await transitionReport(w.ana, code, { to: "TRIAGED", expectedVersion: v });
  v++;
  await assignDepartment(w.ana, code, { departmentId: w.deptId, expectedVersion: v });
  v++;
  await transitionReport(w.ana, code, { to: "IN_PROGRESS", expectedVersion: v });
  v++;
  await addEvidence(w.ana, code, { dataUrl: PNG_1PX, kind: "solution" });
  await transitionReport(w.ana, code, { to: "SOLUTION_PROPOSED", expectedVersion: v });
  v++;
  await transitionReport(w.ana, code, { to: "AWAITING_VERIFICATION", expectedVersion: v });
  v++;
  return v;
}

async function roundsOf(code: string): Promise<VerificationRequest[]> {
  return read((db) => {
    const report = Object.values(db.reports).find(
      (x) => (x as unknown as { code: string }).code === code
    ) as unknown as { id: string };
    return (Object.values(db.verificationRequests) as unknown as VerificationRequest[])
      .filter((vr) => vr.reportId === report.id)
      .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  });
}

async function votesOfRound(roundId: string): Promise<VerificationVote[]> {
  return read((db) =>
    (Object.values(db.verificationVotes) as unknown as VerificationVote[]).filter(
      (v) => v.verificationRequestId === roundId
    )
  );
}

describe("rondas de verificación", () => {
  it("a) resuelve la primera ronda, se reabre y comienza una segunda", async () => {
    const w = await setupWorld();
    const r = await createBasural(w);
    await driveToVerification(w, r.code, 1);

    let rounds = await roundsOf(r.code);
    expect(rounds).toHaveLength(1);
    expect(rounds[0].status).toBe("open");
    expect(rounds[0].solutionProposedAt).not.toBeNull();
    const round1 = rounds[0].id;

    // Vía A: autora + vecino verificado → resuelve y cierra la ronda.
    await voteVerification(w.camila, r.code, { approve: true });
    const v = await voteVerification(w.jorge, r.code, { approve: true });
    expect(v.resolved).toBe(true);
    expect(v.report.state).toBe("VERIFIED_RESOLVED");
    rounds = await roundsOf(r.code);
    expect(rounds).toHaveLength(1);
    expect(rounds[0].id).toBe(round1);
    expect(rounds[0].status).toBe("resolved");

    // Reapertura y segundo ciclo institucional → segunda ronda.
    await transitionReport(w.camila, r.code, {
      to: "REOPENED",
      reason: "Volvió a aparecer basura",
      expectedVersion: 8,
    });
    await driveToVerification(w, r.code, 9, true);
    rounds = await roundsOf(r.code);
    expect(rounds).toHaveLength(2);
    expect(rounds[0].status).toBe("resolved");
    expect(rounds[1].status).toBe("open");
    expect(rounds[1].id).not.toBe(round1);
    // La segunda ronda registra su propio ciclo causal.
    expect(rounds[1].solutionProposedAt).not.toBeNull();
    expect(rounds[1].cycleStartAt).not.toBeNull();
  });

  it("b) los votos de la primera ronda no resuelven la segunda", async () => {
    const w = await setupWorld();
    const r = await createBasural(w);
    await driveToVerification(w, r.code, 1);

    // Ronda 1: un vecino aprueba; la autora rechaza con fundamento → REOPENED
    // (solo el autor puede reabrir con un rechazo).
    await voteVerification(w.jorge, r.code, { approve: true });
    const reopened = await voteVerification(w.camila, r.code, {
      approve: false,
      comment: "Sigue igual, no retiraron nada",
    });
    expect(reopened.report.state).toBe("REOPENED");
    let rounds = await roundsOf(r.code);
    expect(rounds).toHaveLength(1);
    expect(rounds[0].status).toBe("reopened");

    await driveToVerification(w, r.code, 8, true);
    rounds = await roundsOf(r.code);
    expect(rounds).toHaveLength(2);
    const round2 = rounds[1];
    expect(round2.status).toBe("open");

    // Si los votos de la ronda 1 contaran, jorge(r1) + autora(r2) = vía A.
    const v = await voteVerification(w.camila, r.code, { approve: true });
    expect(v.resolved).toBe(false);
    expect(v.report.state).toBe("AWAITING_VERIFICATION");
    expect(await votesOfRound(round2.id)).toHaveLength(1);
  });

  it("c) el primer voto de la segunda ronda no produce resolución automática", async () => {
    const w = await setupWorld();
    const r = await createBasural(w);
    await driveToVerification(w, r.code, 1);
    await voteVerification(w.camila, r.code, {
      approve: false,
      comment: "Sigue igual",
    });
    await driveToVerification(w, r.code, 8, true);
    const v = await voteVerification(w.jorge, r.code, { approve: true });
    expect(v.resolved).toBe(false);
    expect(v.via).toBeNull();
    expect(v.report.state).toBe("AWAITING_VERIFICATION");
    // La segunda ronda se completa con votos propios (vía B).
    await voteVerification(w.lucia, r.code, { approve: true });
    const v2 = await voteVerification(w.diego, r.code, { approve: true });
    expect(v2.resolved).toBe(true);
    expect(v2.via).toBe("community");
  });

  it("d) un usuario puede votar una vez en cada ronda", async () => {
    const w = await setupWorld();
    const r = await createBasural(w);
    await driveToVerification(w, r.code, 1);
    await voteVerification(w.jorge, r.code, { approve: true });
    await voteVerification(w.camila, r.code, {
      approve: false,
      comment: "Sigue igual",
    });
    await driveToVerification(w, r.code, 8, true);
    // Jorge ya votó en la ronda 1: puede votar de nuevo en la ronda 2.
    const v = await voteVerification(w.jorge, r.code, { approve: true });
    expect(v.resolved).toBe(false);
    const rounds = await roundsOf(r.code);
    expect(await votesOfRound(rounds[0].id)).toHaveLength(2); // ronda 1: jorge + camila
    expect(await votesOfRound(rounds[1].id)).toHaveLength(1); // ronda 2: jorge
  });

  it("e) no puede votar dos veces dentro de la misma ronda", async () => {
    const w = await setupWorld();
    const r = await createBasural(w);
    await driveToVerification(w, r.code, 1);
    await voteVerification(w.jorge, r.code, { approve: true });
    await expectCode(
      voteVerification(w.jorge, r.code, { approve: true }),
      "DUPLICATE_VOTE"
    );
  });

  it("f) dos votos concurrentes producen una sola resolución y cierran una sola ronda", async () => {
    const w = await setupWorld();
    const r = await createBasural(w);
    await driveToVerification(w, r.code, 1);
    await voteVerification(w.camila, r.code, { approve: true });
    const results = await Promise.allSettled([
      voteVerification(w.jorge, r.code, { approve: true }),
      voteVerification(w.lucia, r.code, { approve: true }),
    ]);
    const fulfilled = results.filter((x) => x.status === "fulfilled");
    expect(fulfilled.length).toBeGreaterThanOrEqual(1);
    const resolutions = await read((db) =>
      Object.values(db.statusEvents).filter(
        (e) => (e as unknown as { to: string }).to === "VERIFIED_RESOLVED"
      )
    );
    expect(resolutions).toHaveLength(1);
    const rounds = await roundsOf(r.code);
    expect(rounds).toHaveLength(1);
    expect(rounds[0].status).toBe("resolved");
    expect((await getReportByCode(r.code, w.camila)).state).toBe(
      "VERIFIED_RESOLVED"
    );
  });

  it("sin ronda abierta no se puede votar", async () => {
    const w = await setupWorld();
    const r = await createBasural(w);
    await expectCode(
      voteVerification(w.jorge, r.code, { approve: true }),
      "NOT_IN_VERIFICATION"
    );
    // Tras resolver, la ronda está cerrada: tampoco se puede votar.
    await driveToVerification(w, r.code, 1);
    await voteVerification(w.camila, r.code, { approve: true });
    await voteVerification(w.jorge, r.code, { approve: true });
    await expectCode(
      voteVerification(w.lucia, r.code, { approve: true }),
      "NOT_IN_VERIFICATION"
    );
  });
});

describe("causalidad por ciclo", () => {
  /**
   * Ciclo 1: acción acreditada A1 antes de la propuesta 1 → la autora
   * rechaza → REOPENED. Ciclo 2: nueva propuesta y resolución sin acciones
   * nuevas → A1 (del ciclo anterior) NO otorga crédito.
   */
  it("una acción del ciclo anterior no acredita la solución posterior", async () => {
    const w = await setupWorld();
    const r = await createBasural(w);
    await transitionReport(w.ana, r.code, { to: "ACKNOWLEDGED", expectedVersion: 1 });
    await transitionReport(w.ana, r.code, { to: "TRIAGED", expectedVersion: 2 });
    await assignDepartment(w.ana, r.code, { departmentId: w.deptId, expectedVersion: 3 });
    await transitionReport(w.ana, r.code, { to: "IN_PROGRESS", expectedVersion: 4 });
    const ev1 = await addEvidence(w.ana, r.code, { dataUrl: PNG_1PX, kind: "solution" });
    const a1 = await recordMunicipalAction(w.ana, r.code, {
      type: "FIELD_WORK_RECORDED",
      publicDescription: "Retiro inicial de la cuadrilla.",
      evidenceRef: ev1.id,
    });
    await transitionReport(w.ana, r.code, { to: "SOLUTION_PROPOSED", expectedVersion: 5 });
    await transitionReport(w.ana, r.code, { to: "AWAITING_VERIFICATION", expectedVersion: 6 });
    // La autora rechaza la primera solución: se cierra la ronda 1.
    await voteVerification(w.camila, r.code, {
      approve: false,
      comment: "Volvió a ensuciarse a los dos días",
    });

    // Fijar el ciclo 1 con timestamps deterministas.
    const round2info = await transact((db) => {
      const report = Object.values(db.reports).find(
        (x) => (x as unknown as { code: string }).code === r.code
      ) as unknown as { id: string };
      const reopenAt = (
        Object.values(db.statusEvents) as unknown as Array<{
          reportId: string; to: string; createdAt: string;
        }>
      )
        .filter((e) => e.reportId === report.id && e.to === "REOPENED")
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0].createdAt;
      // A1 queda estrictamente dentro del ciclo 1.
      const stored = db.municipalActions[a1.id] as unknown as { createdAt: string };
      stored.createdAt = new Date(new Date(reopenAt).getTime() - 60_000).toISOString();
      return { reopenAt };
    });

    // Ciclo 2: sin acciones municipales nuevas.
    await driveToVerification(w, r.code, 8, true);
    const rounds = await roundsOf(r.code);
    expect(rounds).toHaveLength(2);
    expect(rounds[1].cycleStartAt).toBe(round2info.reopenAt);
    // Resolver la ronda 2 (vía B) sin gestión nueva en el ciclo.
    await voteVerification(w.jorge, r.code, { approve: true });
    await voteVerification(w.lucia, r.code, { approve: true });
    const v = await voteVerification(w.diego, r.code, { approve: true });
    expect(v.resolved).toBe(true);
    expect(v.report.state).toBe("VERIFIED_RESOLVED");
    // A1 es del ciclo anterior: no acredita la solución del ciclo 2.
    expect(v.report.municipalCredit).toBe(false);
    expect(v.report.attribution.municipalCredit.headline).toBe("Problema resuelto");
  });

  it("una acción del ciclo vigente sí acredita (y solo ella cuenta)", async () => {
    const w = await setupWorld();
    const r = await createBasural(w);
    await driveToVerification(w, r.code, 1);
    await voteVerification(w.camila, r.code, {
      approve: false,
      comment: "Sigue igual",
    });
    await driveToVerification(w, r.code, 8, true);

    // Acción acreditada dentro del ciclo 2. Timestamps deterministas:
    // cicloStartAt < acción < solutionProposedAt (estrictamente).
    const ev = await addEvidence(w.ana, r.code, { dataUrl: PNG_1PX, kind: "solution" });
    const a2 = await recordMunicipalAction(w.ana, r.code, {
      type: "FIELD_WORK_RECORDED",
      publicDescription: "Segundo retiro de la cuadrilla.",
      evidenceRef: ev.id,
    });
    await transact((db) => {
      const report = Object.values(db.reports).find(
        (x) => (x as unknown as { code: string }).code === r.code
      ) as unknown as { id: string };
      const round = (
        Object.values(db.verificationRequests) as unknown as VerificationRequest[]
      )
        .filter((x) => x.reportId === report.id && x.status === "open")
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0];
      const base = Date.now();
      const storedRound = db.verificationRequests[round.id] as unknown as {
        cycleStartAt: string | null;
        solutionProposedAt: string | null;
      };
      storedRound.cycleStartAt = new Date(base - 10_000).toISOString();
      storedRound.solutionProposedAt = new Date(base - 1_000).toISOString();
      const stored = db.municipalActions[a2.id] as unknown as { createdAt: string };
      stored.createdAt = new Date(base - 5_000).toISOString();
    });

    await voteVerification(w.jorge, r.code, { approve: true });
    await voteVerification(w.lucia, r.code, { approve: true });
    const v = await voteVerification(w.diego, r.code, { approve: true });
    expect(v.resolved).toBe(true);
    expect(v.report.municipalCredit).toBe(true);
    expect(v.report.attribution.municipalCredit.headline).toBe("Ya estuvo la Muni");
    expect(v.report.attribution.municipalCredit.actions).toHaveLength(1);
    expect(
      v.report.attribution.municipalCredit.actions[0].publicDescription
    ).toBe("Segundo retiro de la cuadrilla.");
  });
});
