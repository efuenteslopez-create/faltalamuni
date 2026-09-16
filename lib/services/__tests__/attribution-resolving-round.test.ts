/**
 * FLM — Iteración 1 (auditoría): la atribución queda vinculada a la ronda
 * que resolvió.
 *
 * El evento `report.verification_resolved` persiste `verificationRequestId`
 * explícitamente, y `buildAttribution` localiza la resolución vigente a
 * través de `resolvingRound` (la ronda resolved más reciente), buscando el
 * evento que coincida con esa ronda. Nunca se usa "el primer auditEvent
 * encontrado".
 *
 * Escenario completo:
 * 1. Primera ronda resuelta vía autor + vecino verificado.
 * 2. El autor rechaza → reporte reabierto.
 * 3. Segunda ronda resuelta vía tres vecinos verificados (el autor no vota).
 * 4. El DTO final muestra mode "community", tres aprobaciones y la fecha
 *    de la SEGUNDA resolución.
 * 5. No muestra los datos de la primera ronda.
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
  getReportByCode,
  getTimeline,
} from "@/lib/services/reports";
import { Actor } from "@/lib/domain/permissions";
import { VerificationRequest } from "@/lib/domain/entities";
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
  camila: Actor; // RESIDENT, autora
  jorge: Actor; // VERIFIED_RESIDENT
  lucia: Actor; // VERIFIED_RESIDENT
  diego: Actor; // VERIFIED_RESIDENT
  ana: Actor; // MUNICIPAL_AGENT org-t
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
    deptId: "dep-t",
  };
}

/** Camino institucional hasta AWAITING_VERIFICATION (abre una ronda). */
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
  return read((db) =>
    (Object.values(db.verificationRequests) as unknown as VerificationRequest[])
      .filter((vr) => {
        const reports = db.reports as Record<string, { id: string; code: string }>;
        const report = Object.values(reports).find((r) => r.code === code);
        return report && vr.reportId === report.id;
      })
      .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))
  );
}

describe("atribución vinculada a la ronda que resolvió", () => {
  it("ronda 1 resuelta → reapertura → ronda 2 resuelta: el DTO muestra solo la segunda", async () => {
    const w = await setupWorld();
    const report = await createReport(w.camila, {
      categoryId: "cat-t",
      municipalityId: "mun-t",
      title: "Microbasural en sitio eriazo",
      description: "Se acumula basura y escombros hace semanas.",
      location: { lng: -70.7489, lat: -33.4408 },
    });
    const code = report.code;

    // 1) Primera ronda: autor + vecino verificado → VERIFIED_RESOLVED (vía A).
    await driveToVerification(w, code, 1);
    const r1 = await voteVerification(w.camila, code, { approve: true });
    expect(r1.resolved).toBe(false);
    const r2 = await voteVerification(w.jorge, code, { approve: true });
    expect(r2.resolved).toBe(true);
    expect(r2.via).toBe("author-plus-neighbor");
    const [round1] = await roundsOf(code);
    expect(round1.status).toBe("resolved");

    // 2) Reapertura: el autor pide REOPENED con fundamento (la ronda 1 ya
    // está cerrada como "resolved").
    const afterResolve = await getReportByCode(code, w.camila);
    await transitionReport(w.camila, code, {
      to: "REOPENED",
      reason: "El basural volvió a aparecer esta semana.",
      expectedVersion: afterResolve.version,
    });
    const [round1b] = await roundsOf(code);
    expect(round1b.status).toBe("resolved");

    // 3) Segunda ronda: tres vecinos verificados (el autor NO vota) → vía B.
    const afterReopen = await getReportByCode(code, w.camila);
    await driveToVerification(w, code, afterReopen.version, true);
    await voteVerification(w.jorge, code, { approve: true });
    await voteVerification(w.lucia, code, { approve: true });
    const r3 = await voteVerification(w.diego, code, { approve: true });
    expect(r3.resolved).toBe(true);
    expect(r3.via).toBe("community");
    const [, round2] = await roundsOf(code);
    expect(round2.status).toBe("resolved");

    // 4) El DTO final muestra la resolución VIGENTE (segunda ronda).
    const dto = await getReportByCode(code, w.camila);
    expect(dto.state).toBe("VERIFIED_RESOLVED");
    expect(dto.attribution.verification).not.toBeNull();
    expect(dto.attribution.verification!.mode).toBe("community");
    expect(dto.attribution.verification!.approvers).toBe(3);
    expect(dto.attribution.verification!.at).toBeTruthy();

    // 5) No se muestran los datos de la primera ronda.
    expect(dto.attribution.verification!.mode).not.toBe("author-plus-neighbor");
    expect(dto.attribution.verification!.approvers).not.toBe(2);

    // El timeline identifica las rondas: votos de ronda 1 marcados como
    // anteriores, votos de ronda 2 como la verificación actual.
    const items = await getTimeline(code, w.camila);
    const votes = items.filter((i) => i.type === "vote");
    expect(votes).toHaveLength(5);
    const round1Votes = votes.filter((i) => i.type === "vote" && i.roundNumber === 1);
    const round2Votes = votes.filter((i) => i.type === "vote" && i.roundNumber === 2);
    expect(round1Votes).toHaveLength(2);
    expect(round2Votes).toHaveLength(3);
    for (const i of round1Votes) {
      expect(i.type === "vote" && i.currentRound).toBe(false);
    }
    for (const i of round2Votes) {
      expect(i.type === "vote" && i.currentRound).toBe(true);
      expect(i.type === "vote" && i.verificationRequestId).toBe(round2.id);
    }
  });
});
