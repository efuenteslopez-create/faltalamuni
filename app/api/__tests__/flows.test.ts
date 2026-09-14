import { describe, it, expect, beforeEach } from "vitest";
import { read, transact, newId, nowIso, CollectionName, Doc } from "@/lib/db/store";
import { ROLES } from "@/lib/domain/types";
import { canEditOriginalReport } from "@/lib/domain/permissions";
import {
  createReport,
  getReportByCode,
  listReports,
  confirmReport,
  followReport,
  unfollowReport,
  transitionReport,
  voteVerification,
  addEvidence,
  addInternalNote,
  listInternalNotes,
  assignDepartment,
  referToAgency,
} from "@/lib/services/reports";
import { getInbox } from "@/lib/services/panel";
import {
  freshDb,
  makeUser,
  makeActor,
  expectCode,
  PNG_1PX,
} from "@/lib/__tests__/support";
import { Actor } from "@/lib/domain/permissions";

beforeEach(() => {
  freshDb();
});

interface World {
  camila: Actor;
  jorge: Actor;
  ana: Actor; // MUNICIPAL_AGENT mun-t
  paula: Actor; // MUNICIPAL_MANAGER mun-t
  marta: Actor; // INDEPENDENT_MODERATOR
  anaOtraOrg: Actor; // MUNICIPAL_AGENT de OTRA org, misma comuna
  anaOtra: Actor; // MUNICIPAL_AGENT de otra comuna y otra org
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
      id: "org-t2", kind: "MUNICIPALITY", name: "Muni Pudahuel Unidad 2",
      shortName: "MP2", verified: true, municipalityId: "mun-t", createdAt: nowIso(),
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
  });
  const camilaU = await makeUser({ email: "camila@f.cl", displayName: "Camila", role: "RESIDENT" });
  const jorgeU = await makeUser({ email: "jorge@f.cl", displayName: "Jorge", role: "VERIFIED_RESIDENT", verifiedResident: true });
  const anaU = await makeUser({ email: "ana@f.cl", displayName: "Ana", role: "MUNICIPAL_AGENT" });
  const paulaU = await makeUser({ email: "paula@f.cl", displayName: "Paula", role: "MUNICIPAL_MANAGER" });
  const martaU = await makeUser({ email: "marta@f.cl", displayName: "Marta", role: "INDEPENDENT_MODERATOR" });
  const anaOtraU = await makeUser({ email: "anaotra@f.cl", displayName: "Ana2", role: "MUNICIPAL_AGENT" });
  const anaOtraOrgU = await makeUser({ email: "anaotraorg@f.cl", displayName: "Ana3", role: "MUNICIPAL_AGENT" });
  await transact((db) => {
    const t = (userId: string, organizationId: string, role: string) => {
      const id = newId();
      db.memberships[id] = { id, userId, organizationId, role, createdAt: nowIso() } as unknown as (typeof db.memberships)[string];
    };
    t(anaU.id, "org-t", "MUNICIPAL_AGENT");
    t(paulaU.id, "org-t", "MUNICIPAL_MANAGER");
    t(anaOtraU.id, "org-otra", "MUNICIPAL_AGENT");
    t(anaOtraOrgU.id, "org-t2", "MUNICIPAL_AGENT");
  });
  return {
    camila: makeActor(camilaU),
    jorge: makeActor(jorgeU),
    ana: makeActor(anaU, { organizationId: "org-t", municipalityIds: ["mun-t"] }),
    paula: makeActor(paulaU, { organizationId: "org-t", municipalityIds: ["mun-t"] }),
    marta: makeActor(martaU),
    anaOtraOrg: makeActor(anaOtraOrgU, { organizationId: "org-t2", municipalityIds: ["mun-t"] }),
    anaOtra: makeActor(anaOtraU, { organizationId: "org-otra", municipalityIds: ["mun-otra"] }),
    categoryId: "cat-t",
    deptId: "dep-t",
    agencyId: "ag-t",
  };
}

const LOC_A = { lng: -70.7489, lat: -33.4408 };
const LOC_B = { lng: -70.7485, lat: -33.4405 }; // ~50m de A

async function createBasural(w: World, author: Actor, loc = LOC_A) {
  return createReport(author, {
    categoryId: w.categoryId,
    municipalityId: "mun-t",
    title: "Microbasural en sitio eriazo",
    description: "Se acumula basura y escombros hace semanas.",
    location: loc,
  });
}

/** Lleva un reporte hasta AWAITING_VERIFICATION por el camino institucional. */
async function driveToVerification(w: World, code: string) {
  await transitionReport(w.ana, code, { to: "ACKNOWLEDGED", expectedVersion: 1 });
  await transitionReport(w.ana, code, { to: "TRIAGED", expectedVersion: 2 });
  await assignDepartment(w.ana, code, { departmentId: w.deptId, expectedVersion: 3 });
  await transitionReport(w.ana, code, { to: "IN_PROGRESS", expectedVersion: 4 });
  await addEvidence(w.ana, code, { dataUrl: PNG_1PX, kind: "solution", description: "Trabajo realizado" });
  await transitionReport(w.ana, code, { to: "SOLUTION_PROPOSED", expectedVersion: 5 });
  await transitionReport(w.ana, code, { to: "AWAITING_VERIFICATION", expectedVersion: 6 });
}

describe("recorridos del spec §19 (nivel servicios)", () => {
  it("1. crear → duplicado detectado → confirmar", async () => {
    const w = await setupWorld();
    const r1 = await createBasural(w, w.camila, LOC_A);
    expect(r1.code).toMatch(/^FLM-PUD-\d{6}$/);
    expect(r1.state).toBe("AWAITING_RESPONSE");

    const r2 = await createBasural(w, w.jorge, LOC_B);
    expect(r2.possibleDuplicates).toContain(r1.code);

    const { confirmationsCount } = await confirmReport(w.jorge, r1.code);
    expect(confirmationsCount).toBe(1);
    const dto = await getReportByCode(r1.code, w.jorge);
    expect(dto.confirmedByMe).toBe(true);
    await expectCode(confirmReport(w.jorge, r1.code), "ALREADY_CONFIRMED");
  });

  it("2. funcionario recibe, clasifica y asigna", async () => {
    const w = await setupWorld();
    const r = await createBasural(w, w.camila);
    const v2 = await transitionReport(w.ana, r.code, { to: "ACKNOWLEDGED", expectedVersion: 1 });
    expect(v2.version).toBe(2);
    const v3 = await transitionReport(w.ana, r.code, { to: "TRIAGED", expectedVersion: 2 });
    expect(v3.state).toBe("TRIAGED");
    const v4 = await assignDepartment(w.ana, r.code, { departmentId: w.deptId, expectedVersion: 3 });
    expect(v4.state).toBe("ASSIGNED");
    expect(v4.version).toBe(4);
    // La ubicación exacta sí es visible para el funcionario con alcance
    expect(v4.location).toEqual(LOC_A);
  });

  it("3. deriva a agencia externa con fundamento", async () => {
    const w = await setupWorld();
    const r = await createBasural(w, w.camila);
    await transitionReport(w.ana, r.code, { to: "TRIAGED", expectedVersion: 1 });
    // Sin fundamento no se puede derivar
    await expectCode(
      referToAgency(w.ana, r.code, { agencyId: w.agencyId, reason: "", expectedVersion: 2 }),
      "VALIDATION"
    );
    const referred = await referToAgency(w.ana, r.code, {
      agencyId: w.agencyId,
      reason: "Competencia de la empresa eléctrica concesionaria.",
      expectedVersion: 2,
    });
    expect(referred.state).toBe("REFERRED");
    const referrals = await read((db) => Object.values(db.referrals).length);
    expect(referrals).toBe(1);
  });

  it("4. informa solución con evidencia → queda en verificación", async () => {
    const w = await setupWorld();
    const r = await createBasural(w, w.camila);
    await transitionReport(w.ana, r.code, { to: "ACKNOWLEDGED", expectedVersion: 1 });
    await transitionReport(w.ana, r.code, { to: "TRIAGED", expectedVersion: 2 });
    await assignDepartment(w.ana, r.code, { departmentId: w.deptId, expectedVersion: 3 });
    await transitionReport(w.ana, r.code, { to: "IN_PROGRESS", expectedVersion: 4 });
    // Sin evidencia no se puede informar solución
    await expectCode(
      transitionReport(w.ana, r.code, { to: "SOLUTION_PROPOSED", expectedVersion: 5 }),
      "EVIDENCE_REQUIRED"
    );
    await addEvidence(w.ana, r.code, { dataUrl: PNG_1PX, kind: "solution" });
    const solved = await transitionReport(w.ana, r.code, { to: "SOLUTION_PROPOSED", expectedVersion: 5 });
    expect(solved.state).toBe("SOLUTION_PROPOSED");
    const pending = await transitionReport(w.ana, r.code, { to: "AWAITING_VERIFICATION", expectedVersion: 6 });
    expect(pending.state).toBe("AWAITING_VERIFICATION");
  });

  it("5. el funcionario NO puede verificar directo (falla)", async () => {
    const w = await setupWorld();
    const r = await createBasural(w, w.camila);
    await driveToVerification(w, r.code);
    await expectCode(
      transitionReport(w.paula, r.code, { to: "VERIFIED_RESOLVED", expectedVersion: 7 }),
      "FORBIDDEN_TRANSITION"
    );
    const dto = await getReportByCode(r.code, w.camila);
    expect(dto.state).toBe("AWAITING_VERIFICATION");
  });

  it("6. ciudadanos verifican → sello 'Ya estuvo la Muni'", async () => {
    const w = await setupWorld();
    const r = await createBasural(w, w.camila);
    await driveToVerification(w, r.code);
    // La autora vota y pesa doble, pero aún no hay quórum (2/3)
    const v1 = await voteVerification(w.camila, r.code, { approve: true, comment: "Pasé y está limpio" });
    expect(v1.votes).toHaveLength(1);
    expect(v1.votes[0].weight).toBe(2);
    expect(v1.resolved).toBe(false);
    expect(v1.report.state).toBe("AWAITING_VERIFICATION");
    // Otro vecino confirma: 2+1=3 alcanza el quórum
    const v2 = await voteVerification(w.jorge, r.code, { approve: true });
    expect(v2.resolved).toBe(true);
    expect(v2.report.state).toBe("VERIFIED_RESOLVED");
    // Gestión municipal acreditada → sello
    expect(v2.report.municipalCredit).toBe(true);
  });

  it("7. la autora rechaza → se reabre", async () => {
    const w = await setupWorld();
    const r = await createBasural(w, w.camila);
    await driveToVerification(w, r.code);
    const result = await voteVerification(w.camila, r.code, {
      approve: false,
      comment: "Sigue igual, no retiraron nada",
    });
    expect(result.resolved).toBe(false);
    expect(result.report.state).toBe("REOPENED");
    const reopens = await read((db) => Object.values(db.reopenRequests).length);
    expect(reopens).toBe(1);
  });

  it("8. notas internas: solo miembros de la organización", async () => {
    const w = await setupWorld();
    const r = await createBasural(w, w.camila);
    // La vecina: ni leer ni escribir
    await expectCode(
      addInternalNote(w.camila, r.code, { message: "quiero ver esto" }),
      "FORBIDDEN"
    );
    await expectCode(listInternalNotes(w.camila, r.code), "FORBIDDEN");
    // Miembro de OTRA organización (misma comuna): no ve las notas de org-t
    // (aislamiento por organización, no error: solo ve las de su propia org)
    const otherNotes = await listInternalNotes(w.anaOtraOrg, r.code);
    expect(otherNotes).toHaveLength(0);
    const note = await addInternalNote(w.ana, r.code, { message: "Coordinar cuadrilla el lunes" });
    expect(note.internal).toBe(true);
    // La otra org sigue sin verla; su propia nota vive en su espacio
    await addInternalNote(w.anaOtraOrg, r.code, { message: "Nota de otra unidad" });
    expect(await listInternalNotes(w.anaOtraOrg, r.code)).toHaveLength(1);
    const notes = await listInternalNotes(w.ana, r.code);
    expect(notes).toHaveLength(1);
    expect(notes[0].message).toBe("Coordinar cuadrilla el lunes");
  });

  it("9. el contenido original es inmutable para todos", async () => {
    const w = await setupWorld();
    for (const role of ROLES) {
      expect(canEditOriginalReport(role)).toBe(false);
    }
    const r = await createBasural(w, w.camila);
    await transitionReport(w.ana, r.code, { to: "ACKNOWLEDGED", expectedVersion: 1 });
    const after = await getReportByCode(r.code, w.camila);
    expect(after.title).toBe(r.title);
    expect(after.description).toBe(r.description);
    expect(after.location ?? after.publicLocation).toBeTruthy();
  });

  it("10. moderación con fundamento: oculta y desaparece del listado público", async () => {
    const w = await setupWorld();
    const r = await createBasural(w, w.camila);
    await expectCode(
      transitionReport(w.marta, r.code, { to: "HIDDEN_BY_MODERATION", expectedVersion: 1 }),
      "REASON_REQUIRED"
    );
    await transitionReport(w.marta, r.code, {
      to: "HIDDEN_BY_MODERATION",
      reason: "Reporte duplicado malicioso",
      expectedVersion: 1,
    });
    await expectCode(getReportByCode(r.code, w.camila), "REPORT_NOT_FOUND");
    const list = await listReports({}, w.camila);
    expect(list.items.find((x) => x.code === r.code)).toBeUndefined();
    // Moderación sí puede verlo
    const hidden = await getReportByCode(r.code, w.marta);
    expect(hidden.state).toBe("HIDDEN_BY_MODERATION");
  });

  it("11. seguir / dejar de seguir", async () => {
    const w = await setupWorld();
    const r = await createBasural(w, w.camila);
    const f1 = await followReport(w.jorge, r.code);
    expect(f1.followersCount).toBe(1);
    await expectCode(followReport(w.jorge, r.code), "ALREADY_FOLLOWING");
    const f0 = await unfollowReport(w.jorge, r.code);
    expect(f0.followersCount).toBe(0);
    await expectCode(unfollowReport(w.jorge, r.code), "NOT_FOLLOWING");
  });

  it("12. bandeja institucional respeta alcance por comuna", async () => {
    const w = await setupWorld();
    const r = await createBasural(w, w.camila);
    // La vecina no tiene bandeja
    await expectCode(getInbox(w.camila), "FORBIDDEN");
    // La funcionaria de Pudahuel ve el reporte pendiente
    const inbox = await getInbox(w.ana);
    expect(inbox.items.map((x) => x.code)).toContain(r.code);
    // La funcionaria de otra comuna no lo ve ni puede tocarlo
    const inboxOtra = await getInbox(w.anaOtra);
    expect(inboxOtra.items.map((x) => x.code)).not.toContain(r.code);
    await expectCode(
      transitionReport(w.anaOtra, r.code, { to: "ACKNOWLEDGED", expectedVersion: 1 }),
      "SCOPE_FORBIDDEN"
    );
  });
});
