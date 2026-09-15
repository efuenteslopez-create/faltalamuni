/**
 * FLM — Iteración 1 (auditoría): crédito municipal con respaldo verificable.
 *
 * Una MunicipalAction es una afirmación institucional: solo otorga crédito
 * si trae un respaldo público verificable validado, registrado por una
 * municipalidad válida (gestora del reporte o de la comuna) y dentro del
 * ciclo causal. Sin respaldo válido el endpoint la rechaza.
 *
 * Casos: acción física sin evidenceRef → rechazada; referencia inexistente
 * → rechazada; evidencia de otro reporte → rechazada; evidencia válida del
 * mismo reporte → acredita; REFERRAL_ACCEPTED_BY_AGENCY exige aceptación
 * de la agencia; coordinación/seguimiento exigen referencia pública
 * modelada; org fuera de ámbito → 403; el timeline y el DTO exponen
 * respaldo y acreditación; jamás se filtran notas internas.
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
  addInternalNote,
  assignDepartment,
  referToAgency,
  recordMunicipalAction,
  registerPublicReference,
  recordReferralAcceptance,
  getReportByCode,
  getTimeline,
} from "@/lib/services/reports";
import { Actor } from "@/lib/domain/permissions";
import { Referral } from "@/lib/domain/entities";
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
  ana: Actor; // MUNICIPAL_AGENT org-t
  paula: Actor; // MUNICIPAL_MANAGER org-t
  ext: Actor; // EXTERNAL_AGENCY_AGENT org-ext
  ext2: Actor; // EXTERNAL_AGENCY_AGENT org-ext2 (otra agencia)
  anaOtra: Actor; // MUNICIPAL_AGENT de org-otra (otra comuna), con alcance mun-t
  categoryId: string;
  deptId: string;
  agencyId: string;
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
    t("municipalities", {
      id: "mun-otra", name: "Otra", prefix: "OTR",
      center: { lng: -70.0, lat: -33.0 }, createdAt: nowIso(),
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
      id: "org-otra", kind: "MUNICIPALITY", name: "Muni Otra",
      shortName: "MO", verified: true, municipalityId: "mun-otra", createdAt: nowIso(),
    });
    t("organizations", {
      id: "org-ext", kind: "EXTERNAL_AGENCY", name: "Eléctrica Demo",
      shortName: "ED", verified: true, municipalityId: "mun-t", createdAt: nowIso(),
    });
    t("departments", {
      id: "dep-t", name: "Aseo y Ornato", municipalityId: "mun-t",
      organizationId: "org-t", createdAt: nowIso(),
    });
    t("externalAgencies", {
      id: "ag-t", organizationId: "org-ext", name: "Eléctrica Demo",
      createdAt: nowIso(),
    });
    t("organizations", {
      id: "org-ext2", kind: "EXTERNAL_AGENCY", name: "Sanitaria Demo",
      shortName: "SD", verified: true, municipalityId: "mun-t", createdAt: nowIso(),
    });
    t("externalAgencies", {
      id: "ag-t2", organizationId: "org-ext2", name: "Sanitaria Demo",
      createdAt: nowIso(),
    });
  });

  const camilaU = await makeUser({ email: "camila@f.cl", displayName: "Camila", role: "RESIDENT" });
  const jorgeU = await makeUser({ email: "jorge@f.cl", displayName: "Jorge", role: "VERIFIED_RESIDENT", verifiedResident: true });
  const anaU = await makeUser({ email: "ana@f.cl", displayName: "Ana", role: "MUNICIPAL_AGENT" });
  const paulaU = await makeUser({ email: "paula@f.cl", displayName: "Paula", role: "MUNICIPAL_MANAGER" });
  const extU = await makeUser({ email: "ext@f.cl", displayName: "Externo", role: "EXTERNAL_AGENCY_AGENT" });
  const ext2U = await makeUser({ email: "ext2@f.cl", displayName: "Externo Dos", role: "EXTERNAL_AGENCY_AGENT" });
  const anaOtraU = await makeUser({ email: "anaotra@f.cl", displayName: "Ana Otra", role: "MUNICIPAL_AGENT" });

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
    link(anaOtraU.id, "org-otra", "MUNICIPAL_AGENT");
  });

  return {
    camila: makeActor(camilaU),
    jorge: makeActor(jorgeU),
    ana: makeActor(anaU, { organizationId: "org-t", municipalityIds: ["mun-t"] }),
    paula: makeActor(paulaU, { organizationId: "org-t", municipalityIds: ["mun-t"] }),
    ext: makeActor(extU, { organizationId: "org-ext", municipalityIds: ["mun-t"] }),
    ext2: makeActor(ext2U, { organizationId: "org-ext2", municipalityIds: ["mun-t"] }),
    anaOtra: makeActor(anaOtraU, { organizationId: "org-otra", municipalityIds: ["mun-t"] }),
    categoryId: "cat-t",
    deptId: "dep-t",
    agencyId: "ag-t",
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

/** Camino institucional con derivación a agencia externa, hasta IN_PROGRESS
 *  (más evidencia). Cada test continúa a SOLUTION_PROPOSED después de
 *  registrar la acción, para que quede dentro del ciclo causal. */
async function driveToInProgressViaReferral(w: World, code: string) {
  await transitionReport(w.ana, code, { to: "ACKNOWLEDGED", expectedVersion: 1 });
  await transitionReport(w.ana, code, { to: "TRIAGED", expectedVersion: 2 });
  await referToAgency(w.ana, code, {
    agencyId: w.agencyId,
    reason: "Competencia de la empresa eléctrica.",
    expectedVersion: 3,
  });
  await transitionReport(w.ana, code, { to: "IN_PROGRESS", expectedVersion: 4 });
  await addEvidence(w.ana, code, { dataUrl: PNG_1PX, kind: "solution" });
}

async function proposeAndAwait(w: World, code: string, version: number) {
  await transitionReport(w.ana, code, { to: "SOLUTION_PROPOSED", expectedVersion: version });
  await transitionReport(w.ana, code, { to: "AWAITING_VERIFICATION", expectedVersion: version + 1 });
}

async function actionCount(code: string): Promise<number> {  return read((db) => {
    const report = Object.values(db.reports).find(
      (x) => (x as unknown as { code: string }).code === code
    ) as unknown as { id: string };
    return Object.values(db.municipalActions).filter(
      (x) => (x as unknown as { reportId: string }).reportId === report.id
    ).length;
  });
}

/**
 * Determinismo temporal: deja la acción estrictamente antes de la propuesta
 * de solución que sigue (evita el empate por resolución de milisegundos).
 */
async function backdateAction(actionId: string): Promise<void> {
  await transact((db) => {
    const stored = db.municipalActions[actionId] as unknown as {
      createdAt: string;
    };
    stored.createdAt = new Date(Date.now() - 5_000).toISOString();
  });
}

describe("respaldo verificable obligatorio", () => {
  it("acción física sin evidenceRef → rechazada (no se almacena)", async () => {
    const w = await setupWorld();
    const r = await createBasural(w);
    await expectCode(
      recordMunicipalAction(w.ana, r.code, {
        type: "FIELD_WORK_RECORDED",
        publicDescription: "Listo",
      }),
      "BACKING_REQUIRED"
    );
    expect(await actionCount(r.code)).toBe(0);
  });

  it("referencia inexistente → rechazada", async () => {
    const w = await setupWorld();
    const r = await createBasural(w);
    await expectCode(
      recordMunicipalAction(w.ana, r.code, {
        type: "CONTRACTOR_ACTION_RECORDED",
        publicDescription: "El contratista retiró el escombro.",
        evidenceRef: "evidencia-que-no-existe",
      }),
      "BACKING_NOT_FOUND"
    );
    expect(await actionCount(r.code)).toBe(0);
  });

  it("evidencia perteneciente a otro reporte → rechazada", async () => {
    const w = await setupWorld();
    const r1 = await createBasural(w);
    const r2 = await createBasural(w);
    const ev = await addEvidence(w.ana, r2.code, {
      dataUrl: PNG_1PX,
      kind: "solution",
    });
    await expectCode(
      recordMunicipalAction(w.ana, r1.code, {
        type: "SOLUTION_EVIDENCE_SUBMITTED",
        publicDescription: "Se presenta evidencia de la solución.",
        evidenceRef: ev.id,
      }),
      "BACKING_MISMATCH"
    );
    expect(await actionCount(r1.code)).toBe(0);
  });

  it("evidencia válida del mismo reporte → acredita y puede dar crédito", async () => {
    const w = await setupWorld();
    const r = await createBasural(w);
    await transitionReport(w.ana, r.code, { to: "ACKNOWLEDGED", expectedVersion: 1 });
    await transitionReport(w.ana, r.code, { to: "TRIAGED", expectedVersion: 2 });
    await assignDepartment(w.ana, r.code, { departmentId: w.deptId, expectedVersion: 3 });
    await transitionReport(w.ana, r.code, { to: "IN_PROGRESS", expectedVersion: 4 });
    const ev = await addEvidence(w.ana, r.code, {
      dataUrl: PNG_1PX,
      kind: "solution",
      description: "Bandejón limpio",
    });
    const action = await recordMunicipalAction(w.ana, r.code, {
      type: "FIELD_WORK_RECORDED",
      publicDescription: "Cuadrilla municipal realizó el retiro.",
      evidenceRef: ev.id,
    });
    expect(action.accredited).toBe(true);
    expect(action.evidenceRef).toBe(ev.id);
    await backdateAction(action.id);
    await transitionReport(w.ana, r.code, { to: "SOLUTION_PROPOSED", expectedVersion: 5 });
    await transitionReport(w.ana, r.code, { to: "AWAITING_VERIFICATION", expectedVersion: 6 });
    await voteVerification(w.camila, r.code, { approve: true });
    const v = await voteVerification(w.jorge, r.code, { approve: true });
    expect(v.resolved).toBe(true);
    expect(v.report.municipalCredit).toBe(true);
    // El DTO público expone acreditación y respaldo.
    const dto = await getReportByCode(r.code, w.camila);
    const dtoAction = dto.attribution.municipalCredit.actions[0];
    expect(dtoAction.accredited).toBe(true);
    expect(dtoAction.backing).not.toBeNull();
    expect(dtoAction.backing?.kind).toBe("resolution-evidence");
    expect(dtoAction.backing?.label).toBe("Evidencia de solución");
  });
});

describe("REFERRAL_ACCEPTED_BY_AGENCY", () => {
  it("sin aceptación de la agencia → rechazada", async () => {
    const w = await setupWorld();
    const r = await createBasural(w);
    await driveToInProgressViaReferral(w, r.code);
    await expectCode(
      recordMunicipalAction(w.paula, r.code, {
        type: "REFERRAL_ACCEPTED_BY_AGENCY",
        publicDescription: "La agencia aceptó la derivación.",
      }),
      "BACKING_REQUIRED"
    );
  });

  it("con aceptación registrada por la agencia receptora → acredita", async () => {
    const w = await setupWorld();
    const r = await createBasural(w);
    await driveToInProgressViaReferral(w, r.code);
    const referralId = await read((db) => {
      const report = Object.values(db.reports).find(
        (x) => (x as unknown as { code: string }).code === r.code
      ) as unknown as { id: string };
      return (
        Object.values(db.referrals) as unknown as Referral[]
      ).find((x) => x.reportId === report.id)!.id;
    });
    const acceptance = await recordReferralAcceptance(w.ext, r.code, {
      referralId,
      accepted: true,
      message: "Aceptamos la derivación; cuadrilla asignada para esta semana.",
    });
    const action = await recordMunicipalAction(w.paula, r.code, {
      type: "REFERRAL_ACCEPTED_BY_AGENCY",
      publicDescription: "La empresa eléctrica aceptó la derivación.",
      evidenceRef: acceptance.id,
    });
    expect(action.accredited).toBe(true);
    await backdateAction(action.id);
    await proposeAndAwait(w, r.code, 5);
    await voteVerification(w.camila, r.code, { approve: true });
    const v = await voteVerification(w.jorge, r.code, { approve: true });
    expect(v.resolved).toBe(true);
    expect(v.report.municipalCredit).toBe(true);
    const backing = v.report.attribution.municipalCredit.actions[0].backing;
    expect(backing?.kind).toBe("referral-acceptance");
    expect(backing?.reference).toContain("Eléctrica Demo");
  });

  it("la aceptación solo la registra la agencia receptora", async () => {
    const w = await setupWorld();
    const r = await createBasural(w);
    await driveToInProgressViaReferral(w, r.code);
    const referralId = await read((db) => {
      const report = Object.values(db.reports).find(
        (x) => (x as unknown as { code: string }).code === r.code
      ) as unknown as { id: string };
      return (
        Object.values(db.referrals) as unknown as Referral[]
      ).find((x) => x.reportId === report.id)!.id;
    });
    // Un funcionario municipal no tiene la capacidad de responder derivaciones.
    await expectCode(
      recordReferralAcceptance(w.ana, r.code, {
        referralId,
        accepted: true,
        message: "La municipalidad dice que la agencia aceptó.",
      }),
      "FORBIDDEN"
    );
    // Y una agencia distinta tampoco puede responder por la receptora.
    await expectCode(
      recordReferralAcceptance(w.ext2, r.code, {
        referralId,
        accepted: true,
        message: "Otra agencia responde por la receptora.",
      }),
      "FORBIDDEN"
    );
  });

  it("una derivación rechazada por la agencia no acredita", async () => {
    const w = await setupWorld();
    const r = await createBasural(w);
    await driveToInProgressViaReferral(w, r.code);
    const referralId = await read((db) => {
      const report = Object.values(db.reports).find(
        (x) => (x as unknown as { code: string }).code === r.code
      ) as unknown as { id: string };
      return (
        Object.values(db.referrals) as unknown as Referral[]
      ).find((x) => x.reportId === report.id)!.id;
    });
    const rejection = await recordReferralAcceptance(w.ext, r.code, {
      referralId,
      accepted: false,
      message: "No corresponde a nuestra zona de concesión.",
    });
    await expectCode(
      recordMunicipalAction(w.paula, r.code, {
        type: "REFERRAL_ACCEPTED_BY_AGENCY",
        publicDescription: "La agencia habría aceptado.",
        evidenceRef: rejection.id,
      }),
      "INVALID_BACKING"
    );
  });
});

describe("coordinación y seguimiento con referencia pública", () => {
  it("una URL inválida no es una referencia verificable", async () => {
    const w = await setupWorld();
    const r = await createBasural(w);
    await expectCode(
      registerPublicReference(w.ana, r.code, {
        kind: "url",
        reference: "nota interna sin url",
        summary: "Supuesta publicación.",
      }),
      "VALIDATION"
    );
  });

  it("una referencia pública válida acredita la coordinación", async () => {
    const w = await setupWorld();
    const r = await createBasural(w);
    await transitionReport(w.ana, r.code, { to: "ACKNOWLEDGED", expectedVersion: 1 });
    await transitionReport(w.ana, r.code, { to: "TRIAGED", expectedVersion: 2 });
    await assignDepartment(w.ana, r.code, { departmentId: w.deptId, expectedVersion: 3 });
    await transitionReport(w.ana, r.code, { to: "IN_PROGRESS", expectedVersion: 4 });
    const ref = await registerPublicReference(w.paula, r.code, {
      kind: "url",
      reference: "https://munipudahuel.cl/transparencia/oficios/2026-1842",
      summary: "Oficio público de coordinación con la empresa eléctrica.",
    });
    const action = await recordMunicipalAction(w.paula, r.code, {
      type: "EXTERNAL_COORDINATION_RECORDED",
      publicDescription: "Coordinación con la empresa eléctrica.",
      evidenceRef: ref.id,
    });
    expect(action.accredited).toBe(true);
    await backdateAction(action.id);
    await addEvidence(w.ana, r.code, { dataUrl: PNG_1PX, kind: "solution" });
    await transitionReport(w.ana, r.code, { to: "SOLUTION_PROPOSED", expectedVersion: 5 });
    await transitionReport(w.ana, r.code, { to: "AWAITING_VERIFICATION", expectedVersion: 6 });
    await voteVerification(w.camila, r.code, { approve: true });
    const v = await voteVerification(w.jorge, r.code, { approve: true });
    expect(v.report.municipalCredit).toBe(true);
    const backing = v.report.attribution.municipalCredit.actions[0].backing;
    expect(backing?.kind).toBe("public-reference");
    expect(backing?.reference).toBe(
      "https://munipudahuel.cl/transparencia/oficios/2026-1842"
    );
  });

  it("una referencia de otro reporte no sirve", async () => {
    const w = await setupWorld();
    const r1 = await createBasural(w);
    const r2 = await createBasural(w);
    const ref = await registerPublicReference(w.ana, r2.code, {
      kind: "document",
      reference: "OF-2026-9999",
      summary: "Oficio del otro reporte.",
    });
    await expectCode(
      recordMunicipalAction(w.ana, r1.code, {
        type: "FOLLOW_UP_RECORDED",
        publicDescription: "Seguimiento registrado.",
        evidenceRef: ref.id,
      }),
      "BACKING_MISMATCH"
    );
  });
});

describe("ámbito de la organización", () => {
  it("una municipalidad de otra comuna no registra acciones", async () => {
    const w = await setupWorld();
    const r = await createBasural(w);
    const ev = await addEvidence(w.ana, r.code, {
      dataUrl: PNG_1PX,
      kind: "solution",
    });
    await expectCode(
      recordMunicipalAction(w.anaOtra, r.code, {
        type: "FIELD_WORK_RECORDED",
        publicDescription: "Trabajo de otra comuna.",
        evidenceRef: ev.id,
      }),
      "FORBIDDEN"
    );
  });
});

describe("timeline público y notas internas", () => {
  it("las acciones acreditadas aparecen en el timeline con su respaldo", async () => {
    const w = await setupWorld();
    const r = await createBasural(w);
    await transitionReport(w.ana, r.code, { to: "ACKNOWLEDGED", expectedVersion: 1 });
    await transitionReport(w.ana, r.code, { to: "TRIAGED", expectedVersion: 2 });
    await assignDepartment(w.ana, r.code, { departmentId: w.deptId, expectedVersion: 3 });
    await transitionReport(w.ana, r.code, { to: "IN_PROGRESS", expectedVersion: 4 });
    const ev = await addEvidence(w.ana, r.code, {
      dataUrl: PNG_1PX,
      kind: "solution",
      description: "Bandejón limpio",
    });
    await recordMunicipalAction(w.ana, r.code, {
      type: "FIELD_WORK_RECORDED",
      publicDescription: "Cuadrilla municipal realizó el retiro.",
      evidenceRef: ev.id,
    });
    await addInternalNote(w.ana, r.code, {
      message: "NOTA SECRETA: el contratista llegó tarde otra vez",
    });
    await transitionReport(w.ana, r.code, { to: "SOLUTION_PROPOSED", expectedVersion: 5 });
    await transitionReport(w.ana, r.code, { to: "AWAITING_VERIFICATION", expectedVersion: 6 });

    const timeline = await getTimeline(r.code, null);
    const actionItems = timeline.filter((i) => i.type === "municipal-action");
    expect(actionItems).toHaveLength(1);
    const item = actionItems[0];
    if (item.type !== "municipal-action") throw new Error("tipo inesperado");
    expect(item.accredited).toBe(true);
    expect(item.publicDescription).toBe("Cuadrilla municipal realizó el retiro.");
    expect(item.backing).not.toBeNull();
    expect(item.backing?.kind).toBe("resolution-evidence");
    // Jamás se filtran notas internas en el timeline público.
    expect(JSON.stringify(timeline)).not.toContain("NOTA SECRETA");
    expect(JSON.stringify(timeline)).not.toContain("contratista llegó tarde");
  });

  it("el DTO público no expone notas internas", async () => {
    const w = await setupWorld();
    const r = await createBasural(w);
    await addInternalNote(w.paula, r.code, {
      message: "NOTA SECRETA DTO: priorizar por reclamo del concejal",
    });
    const dto = await getReportByCode(r.code, null);
    expect(JSON.stringify(dto)).not.toContain("NOTA SECRETA DTO");
    expect(JSON.stringify(dto)).not.toContain("concejal");
  });
});
