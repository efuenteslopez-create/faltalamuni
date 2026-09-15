/**
 * FLM — Iteración 1 (auditoría): verificación independiente y crédito
 * municipal causal.
 *
 * Los 15 casos obligatorios:
 *  1. admin intenta verificar directo → 403.
 *  2. moderador intenta verificar directo → 403.
 *  3. moderador emite un voto positivo → 403.
 *  4. funcionario intenta verificar → 403.
 *  5. autor aprueba sin segundo verificador → sigue pendiente.
 *  6. autor + vecino verificado → resuelto.
 *  7. tres vecinos verificados sin autor → resuelto.
 *  8. tres cuentas no verificadas → no resuelven.
 *  9. cuenta vinculada a la municipalidad intenta votar → 403.
 * 10. reconocer un reporte no entrega crédito municipal.
 * 11. responder públicamente no entrega crédito municipal.
 * 12. derivar sin seguimiento no entrega crédito municipal.
 * 13. gestión acreditada + solución verificada → "Ya estuvo la Muni".
 * 14. solución verificada sin gestión municipal → "Problema resuelto".
 * 15. dos solicitudes concurrentes no resuelven dos veces.
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
import { DomainError } from "@/lib/domain/types";
import { mapError } from "@/lib/api/http";
import {
  createReport,
  transitionReport,
  voteVerification,
  addEvidence,
  addPublicResponse,
  assignDepartment,
  referToAgency,
  recordMunicipalAction,
  getReportByCode,
} from "@/lib/services/reports";
import { evaluateVerificationQuorum } from "@/lib/domain/verification";
import { hasCapability } from "@/lib/domain/permissions";
import { Actor } from "@/lib/domain/permissions";
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
  pedro: Actor; // RESIDENT no verificado
  pablo: Actor; // RESIDENT no verificado
  pepe: Actor; // RESIDENT no verificado
  ana: Actor; // MUNICIPAL_AGENT org-t
  paula: Actor; // MUNICIPAL_MANAGER org-t
  marta: Actor; // INDEPENDENT_MODERATOR
  admin: Actor; // PLATFORM_ADMIN
  ext: Actor; // EXTERNAL_AGENCY_AGENT org-ext
  muniLinked: Actor; // RESIDENT con membresía en org-t (conflicto de interés)
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
    t("departments", {
      id: "dep-t", name: "Aseo y Ornato", municipalityId: "mun-t",
      organizationId: "org-t", createdAt: nowIso(),
    });
    t("externalAgencies", {
      id: "ag-t", organizationId: "org-ext", name: "Eléctrica Demo",
      createdAt: nowIso(),
    });
  });

  const mk = async (
    email: string, displayName: string,
    role: Parameters<typeof makeUser>[0]["role"],
    verifiedResident = false
  ) => makeUser({ email, displayName, role, verifiedResident });

  const camilaU = await mk("camila@f.cl", "Camila", "RESIDENT");
  const jorgeU = await mk("jorge@f.cl", "Jorge", "VERIFIED_RESIDENT", true);
  const luciaU = await mk("lucia@f.cl", "Lucía", "VERIFIED_RESIDENT", true);
  const diegoU = await mk("diego@f.cl", "Diego", "VERIFIED_RESIDENT", true);
  const pedroU = await mk("pedro@f.cl", "Pedro", "RESIDENT");
  const pabloU = await mk("pablo@f.cl", "Pablo", "RESIDENT");
  const pepeU = await mk("pepe@f.cl", "Pepe", "RESIDENT");
  const anaU = await mk("ana@f.cl", "Ana", "MUNICIPAL_AGENT");
  const paulaU = await mk("paula@f.cl", "Paula", "MUNICIPAL_MANAGER");
  const martaU = await mk("marta@f.cl", "Marta", "INDEPENDENT_MODERATOR");
  const adminU = await mk("admin@f.cl", "Admin", "PLATFORM_ADMIN");
  const extU = await mk("ext@f.cl", "Externo", "EXTERNAL_AGENCY_AGENT");
  const linkedU = await mk("vinculado@f.cl", "Vinculado", "RESIDENT");

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
    // Cuenta ciudadana pero vinculada a la municipalidad (conflicto).
    link(linkedU.id, "org-t", "MUNICIPAL_AGENT");
  });

  return {
    camila: makeActor(camilaU),
    jorge: makeActor(jorgeU),
    lucia: makeActor(luciaU),
    diego: makeActor(diegoU),
    pedro: makeActor(pedroU),
    pablo: makeActor(pabloU),
    pepe: makeActor(pepeU),
    ana: makeActor(anaU, { organizationId: "org-t", municipalityIds: ["mun-t"] }),
    paula: makeActor(paulaU, { organizationId: "org-t", municipalityIds: ["mun-t"] }),
    marta: makeActor(martaU),
    admin: makeActor(adminU),
    ext: makeActor(extU, { organizationId: "org-ext", municipalityIds: ["mun-t"] }),
    muniLinked: makeActor(linkedU, { organizationId: "org-t", municipalityIds: ["mun-t"] }),
    categoryId: "cat-t",
    deptId: "dep-t",
    agencyId: "ag-t",
  };
}

const LOC = { lng: -70.7489, lat: -33.4408 };

async function createBasural(w: World, author: Actor = w.camila) {
  return createReport(author, {
    categoryId: w.categoryId,
    municipalityId: "mun-t",
    title: "Microbasural en sitio eriazo",
    description: "Se acumula basura y escombros hace semanas.",
    location: LOC,
  });
}

/**
 * Camino institucional SIN acciones municipales acreditables (para probar
 * que el flujo por sí solo no otorga crédito).
 */
async function driveToVerificationBare(w: World, code: string) {
  await transitionReport(w.ana, code, { to: "ACKNOWLEDGED", expectedVersion: 1 });
  await transitionReport(w.ana, code, { to: "TRIAGED", expectedVersion: 2 });
  await assignDepartment(w.ana, code, { departmentId: w.deptId, expectedVersion: 3 });
  await transitionReport(w.ana, code, { to: "IN_PROGRESS", expectedVersion: 4 });
  await addEvidence(w.ana, code, { dataUrl: PNG_1PX, kind: "solution" });
  await transitionReport(w.ana, code, { to: "SOLUTION_PROPOSED", expectedVersion: 5 });
  await transitionReport(w.ana, code, { to: "AWAITING_VERIFICATION", expectedVersion: 6 });
}

/** Resuelve por vía A (autora + vecino verificado). */
async function resolveViaA(w: World, code: string) {
  await voteVerification(w.camila, code, { approve: true });
  return voteVerification(w.jorge, code, { approve: true });
}

/** Captura el error lanzado por una promesa. */
async function catchError(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (e) {
    return e;
  }
  throw new Error("Se esperaba que fallara, pero no falló");
}

describe("hallazgo 1: nadie verifica directamente", () => {
  it("1. admin intenta transición directa a VERIFIED_RESOLVED → 403", async () => {
    const w = await setupWorld();
    const r = await createBasural(w);
    await driveToVerificationBare(w, r.code);
    const err = await catchError(
      transitionReport(w.admin, r.code, { to: "VERIFIED_RESOLVED", expectedVersion: 7 })
    );
    expect((err as DomainError).code).toBe("FORBIDDEN");
    expect(mapError(err).status).toBe(403);
    expect(hasCapability("PLATFORM_ADMIN", "report.verify")).toBe(false);
  });

  it("1b. admin intenta votar una solución → 403", async () => {
    const w = await setupWorld();
    const r = await createBasural(w);
    await driveToVerificationBare(w, r.code);
    const err = await catchError(
      voteVerification(w.admin, r.code, { approve: true })
    );
    expect((err as DomainError).code).toBe("FORBIDDEN");
    expect(mapError(err).status).toBe(403);
  });

  it("2. moderador intenta transición directa a VERIFIED_RESOLVED → 403", async () => {
    const w = await setupWorld();
    const r = await createBasural(w);
    await driveToVerificationBare(w, r.code);
    const err = await catchError(
      transitionReport(w.marta, r.code, { to: "VERIFIED_RESOLVED", expectedVersion: 7 })
    );
    // El esquema/servicio la rechazan antes de la máquina de estados.
    expect(["FORBIDDEN", "FORBIDDEN_TRANSITION"]).toContain(
      (err as DomainError).code
    );
    expect(mapError(err).status).toBe(403);
  });

  it("3. moderador emite un voto positivo → 403", async () => {
    const w = await setupWorld();
    const r = await createBasural(w);
    await driveToVerificationBare(w, r.code);
    const err = await catchError(
      voteVerification(w.marta, r.code, { approve: true, comment: "Se ve bien" })
    );
    expect((err as DomainError).code).toBe("FORBIDDEN");
    expect(mapError(err).status).toBe(403);
    // El estado no cambió.
    expect((await getReportByCode(r.code, w.camila)).state).toBe(
      "AWAITING_VERIFICATION"
    );
  });

  it("4. funcionario y agencia externa intentan verificar → 403", async () => {
    const w = await setupWorld();
    const r = await createBasural(w);
    await driveToVerificationBare(w, r.code);
    for (const actor of [w.ana, w.paula, w.ext]) {
      const errT = await catchError(
        transitionReport(actor, r.code, { to: "VERIFIED_RESOLVED", expectedVersion: 7 })
      );
      expect(["FORBIDDEN", "FORBIDDEN_TRANSITION"]).toContain(
        (errT as DomainError).code
      );
      expect(mapError(errT).status).toBe(403);
      const errV = await catchError(
        voteVerification(actor, r.code, { approve: true })
      );
      expect((errV as DomainError).code).toBe("FORBIDDEN");
      expect(mapError(errV).status).toBe(403);
    }
    expect((await getReportByCode(r.code, w.camila)).state).toBe(
      "AWAITING_VERIFICATION"
    );
  });
});

describe("hallazgo 2: quórum ciudadano real", () => {
  it("5. autor aprueba sin segundo verificador → sigue pendiente", async () => {
    const w = await setupWorld();
    const r = await createBasural(w);
    await driveToVerificationBare(w, r.code);
    const v = await voteVerification(w.camila, r.code, { approve: true });
    expect(v.resolved).toBe(false);
    expect(v.via).toBeNull();
    expect(v.report.state).toBe("AWAITING_VERIFICATION");
  });

  it("6. autor + vecino verificado → resuelto (vía A)", async () => {
    const w = await setupWorld();
    const r = await createBasural(w);
    await driveToVerificationBare(w, r.code);
    const v = await resolveViaA(w, r.code);
    expect(v.resolved).toBe(true);
    expect(v.via).toBe("author-plus-neighbor");
    expect(v.report.state).toBe("VERIFIED_RESOLVED");
    // La resolución quedó auditada con los votos que la activaron.
    const audits = await read((db) =>
      Object.values(db.auditEvents).filter(
        (e) =>
          (e as unknown as { action: string }).action === "report.verification_resolved"
      )
    );
    expect(audits).toHaveLength(1);
    const detail = (audits[0] as unknown as { detail: Record<string, unknown> }).detail;
    expect(detail["via"]).toBe("author-plus-neighbor");
    expect(detail["approvingVoterIds"]).toContain(w.camila.id);
    expect(detail["approvingVoterIds"]).toContain(w.jorge.id);
  });

  it("7. tres vecinos verificados sin autor → resuelto (vía B)", async () => {
    const w = await setupWorld();
    // Autora distinta para que camila no participe.
    const r = await createBasural(w, w.pedro);
    await driveToVerificationBare(w, r.code);
    await voteVerification(w.jorge, r.code, { approve: true });
    await voteVerification(w.lucia, r.code, { approve: true });
    const v = await voteVerification(w.diego, r.code, { approve: true });
    expect(v.resolved).toBe(true);
    expect(v.via).toBe("community");
    expect(v.report.state).toBe("VERIFIED_RESOLVED");
  });

  it("8. tres cuentas no verificadas → no resuelven", async () => {
    const w = await setupWorld();
    const r = await createBasural(w, w.pedro);
    await driveToVerificationBare(w, r.code);
    await voteVerification(w.pedro, r.code, { approve: true });
    await voteVerification(w.pablo, r.code, { approve: true });
    const v = await voteVerification(w.pepe, r.code, { approve: true });
    expect(v.resolved).toBe(false);
    expect(v.report.state).toBe("AWAITING_VERIFICATION");
  });

  it("9. cuenta vinculada a la municipalidad intenta votar → 403", async () => {
    const w = await setupWorld();
    const r = await createBasural(w);
    await driveToVerificationBare(w, r.code);
    // El reporte queda bajo gestión de org-t.
    await transact((db) => {
      const report = Object.values(db.reports).find(
        (x) => (x as unknown as { code: string }).code === r.code
      ) as unknown as { managingOrgId: string | null };
      report.managingOrgId = "org-t";
    });
    const err = await catchError(
      voteVerification(w.muniLinked, r.code, { approve: true })
    );
    expect((err as DomainError).code).toBe("FORBIDDEN");
    expect(mapError(err).status).toBe(403);
  });

  it("quórum puro: el bypass del moderador ya no existe", () => {
    // Un solo voto moderador no aparece en la evaluación: la función pura
    // solo cuenta ciudadanía verificada no vinculada.
    const evalResult = evaluateVerificationQuorum("author-1", [
      { voterId: "mod-1", approve: true, verifiedResident: false, linkedToManagingOrg: false },
    ]);
    expect(evalResult.resolved).toBe(false);
  });

  it("15. dos solicitudes concurrentes no resuelven dos veces", async () => {
    const w = await setupWorld();
    const r = await createBasural(w);
    await driveToVerificationBare(w, r.code);
    await voteVerification(w.camila, r.code, { approve: true });
    // Dos vecinos votan "al mismo tiempo": solo una resolución.
    const results = await Promise.allSettled([
      voteVerification(w.jorge, r.code, { approve: true }),
      voteVerification(w.lucia, r.code, { approve: true }),
    ]);
    const fulfilled = results.filter((x) => x.status === "fulfilled");
    expect(fulfilled.length).toBeGreaterThanOrEqual(1);
    const resolutions = await read((db) =>
      Object.values(db.statusEvents).filter(
        (e) =>
          (e as unknown as { to: string }).to === "VERIFIED_RESOLVED"
      )
    );
    expect(resolutions).toHaveLength(1);
    expect((await getReportByCode(r.code, w.camila)).state).toBe(
      "VERIFIED_RESOLVED"
    );
  });
});

describe("hallazgo 3: crédito municipal causal", () => {
  it("10. reconocer la recepción no entrega crédito", async () => {
    const w = await setupWorld();
    const r = await createBasural(w);
    await driveToVerificationBare(w, r.code);
    const v = await resolveViaA(w, r.code);
    expect(v.report.state).toBe("VERIFIED_RESOLVED");
    expect(v.report.municipalCredit).toBe(false);
    expect(v.report.attribution.municipalCredit.granted).toBe(false);
    expect(v.report.attribution.municipalCredit.headline).toBe("Problema resuelto");
  });

  it("11. responder públicamente no entrega crédito", async () => {
    const w = await setupWorld();
    const r = await createBasural(w);
    await driveToVerificationBare(w, r.code);
    await addPublicResponse(w.ana, r.code, {
      message: "Estamos trabajando en el retiro.",
    });
    const v = await resolveViaA(w, r.code);
    expect(v.report.municipalCredit).toBe(false);
  });

  it("12. derivar sin seguimiento no entrega crédito", async () => {
    const w = await setupWorld();
    const r = await createBasural(w);
    await transitionReport(w.ana, r.code, { to: "TRIAGED", expectedVersion: 1 });
    await referToAgency(w.ana, r.code, {
      agencyId: w.agencyId,
      reason: "Competencia de la empresa eléctrica.",
      expectedVersion: 2,
    });
    await transitionReport(w.ana, r.code, { to: "IN_PROGRESS", expectedVersion: 3 });
    await addEvidence(w.ana, r.code, { dataUrl: PNG_1PX, kind: "solution" });
    await transitionReport(w.ana, r.code, { to: "SOLUTION_PROPOSED", expectedVersion: 4 });
    await transitionReport(w.ana, r.code, { to: "AWAITING_VERIFICATION", expectedVersion: 5 });
    const v = await resolveViaA(w, r.code);
    expect(v.report.municipalCredit).toBe(false);
    expect(v.report.attribution.municipalCredit.headline).toBe("Problema resuelto");
  });

  it("13. gestión acreditada + verificado → 'Ya estuvo la Muni'", async () => {
    const w = await setupWorld();
    const r = await createBasural(w);
    await transitionReport(w.ana, r.code, { to: "ACKNOWLEDGED", expectedVersion: 1 });
    await transitionReport(w.ana, r.code, { to: "TRIAGED", expectedVersion: 2 });
    await assignDepartment(w.ana, r.code, { departmentId: w.deptId, expectedVersion: 3 });
    await transitionReport(w.ana, r.code, { to: "IN_PROGRESS", expectedVersion: 4 });
    const action = await recordMunicipalAction(w.paula, r.code, {
      type: "EXTERNAL_COORDINATION_RECORDED",
      publicDescription: "La municipalidad coordinó con la empresa eléctrica el retiro.",
    });
    expect(action.type).toBe("EXTERNAL_COORDINATION_RECORDED");
    await addEvidence(w.ana, r.code, { dataUrl: PNG_1PX, kind: "solution" });
    await transitionReport(w.ana, r.code, { to: "SOLUTION_PROPOSED", expectedVersion: 5 });
    await transitionReport(w.ana, r.code, { to: "AWAITING_VERIFICATION", expectedVersion: 6 });
    const v = await resolveViaA(w, r.code);
    expect(v.report.municipalCredit).toBe(true);
    const credit = v.report.attribution.municipalCredit;
    expect(credit.granted).toBe(true);
    expect(credit.headline).toBe("Ya estuvo la Muni");
    expect(credit.explanation).toContain("Ya estuvo la Muni");
    expect(credit.explanation).toContain("Muni Pudahuel");
    expect(credit.actions).toHaveLength(1);
    expect(credit.actions[0].typeLabel).toBe("Coordinación externa acreditada");
  });

  it("una acción posterior a la solución informada no es causal", async () => {
    const w = await setupWorld();
    const r = await createBasural(w);
    await driveToVerificationBare(w, r.code);
    // La acción se registra cuando la solución ya estaba informada: la
    // marcamos con un timestamp explícitamente posterior (una hora después).
    const action = await recordMunicipalAction(w.ana, r.code, {
      type: "FOLLOW_UP_RECORDED",
      publicDescription: "Visita posterior de fiscalización.",
    });
    await transact((db) => {
      const stored = db.municipalActions[action.id] as unknown as {
        createdAt: string;
      };
      stored.createdAt = new Date(Date.now() + 3_600_000).toISOString();
    });
    const v = await resolveViaA(w, r.code);
    expect(v.report.municipalCredit).toBe(false);
    expect(v.report.attribution.municipalCredit.headline).toBe("Problema resuelto");
  });

  it("14. verificado sin gestión municipal → 'Problema resuelto'", async () => {
    const w = await setupWorld();
    const r = await createBasural(w);
    await driveToVerificationBare(w, r.code);
    const v = await resolveViaA(w, r.code);
    expect(v.report.state).toBe("VERIFIED_RESOLVED");
    expect(v.report.municipalCredit).toBe(false);
    expect(v.report.attribution.municipalCredit.headline).toBe("Problema resuelto");
    expect(v.report.attribution.municipalCredit.explanation).toContain(
      "Problema resuelto"
    );
    expect(v.report.attribution.municipalCredit.explanation).not.toContain(
      "Ya estuvo la Muni"
    );
  });

  it("una agencia externa no puede registrar acciones municipales", async () => {
    const w = await setupWorld();
    const r = await createBasural(w);
    await expectCode(
      recordMunicipalAction(w.ext, r.code, {
        type: "FIELD_WORK_RECORDED",
        publicDescription: "Trabajo de la empresa externa.",
      }),
      "FORBIDDEN"
    );
  });
});
