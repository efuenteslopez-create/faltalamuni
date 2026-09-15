/**
 * FLM — Utilidades compartidas de los servicios.
 * Todo lo que corre dentro de una transacción vive aquí para no duplicar
 * lógica ni anidar `transact` (anidar = deadlock en el adaptador demo).
 */
import {
  CollectionName,
  Database,
  Doc,
  newId,
  nowIso,
} from "@/lib/db/store";
import {
  AuditEvent,
  Category,
  DomainError,
  Organization,
  REPORT_STATE_GROUPS,
  REPORT_STATE_LABELS,
  Report,
  ReportState,
  StatusEvent,
  User,
} from "@/lib/domain/types";
import { assertTransition, ActorRole } from "@/lib/domain/state-machine";
import { Actor, inScope, isInstitutionalRole } from "@/lib/domain/permissions";
import {
  Confirmation,
  Follower,
  Municipality,
  PossibleDuplicate,
  ReportDto,
  MunicipalAction,
  Attribution,
  MUNICIPAL_ACTION_LABELS,
} from "@/lib/domain/entities";

/** Lectura tipada dentro de una transacción/lectura. */
export function get<T>(
  db: Database,
  coll: CollectionName,
  id: string
): T | undefined {
  return db[coll][id] as unknown as T | undefined;
}

/** Escritura tipada dentro de una transacción. */
export function put<T extends { id: string }>(
  db: Database,
  coll: CollectionName,
  doc: T
): void {
  db[coll][doc.id] = doc as unknown as Doc;
}

/** Todos los documentos de una colección, tipados. */
export function all<T>(db: Database, coll: CollectionName): T[] {
  return Object.values(db[coll]) as unknown as T[];
}

/**
 * Auditoría dentro de una transacción existente. NO usar `audit()` de
 * lib/audit.ts aquí: hace su propio `transact` y se bloquearía.
 */
export function auditTx(
  db: Database,
  input: {
    action: string;
    actorId: string | null;
    entityType: string;
    entityId: string;
    detail?: Record<string, unknown>;
  }
): void {
  const event: AuditEvent = {
    id: newId(),
    action: input.action,
    actorId: input.actorId,
    entityType: input.entityType,
    entityId: input.entityId,
    detail: input.detail ?? {},
    createdAt: nowIso(),
  };
  put(db, "auditEvents", event);
}

/** Busca un reporte por código público o lanza REPORT_NOT_FOUND. */
export function loadReportTx(db: Database, code: string): Report {
  const report = all<Report>(db, "reports").find((r) => r.code === code);
  if (!report) {
    throw new DomainError("REPORT_NOT_FOUND", `Reporte ${code} no encontrado`);
  }
  return report;
}

/** Chequeo de concurrencia optimista. */
export function checkVersion(report: Report, expectedVersion: number): void {
  if (report.version !== expectedVersion) {
    throw new DomainError(
      "VERSION_CONFLICT",
      `El reporte cambió mientras lo editabas (versión actual ${report.version}). Recarga e intenta de nuevo.`
    );
  }
}

export interface TransitionTxOpts {
  to: ReportState;
  actorId: string | null;
  actorRole: ActorRole;
  reason?: string | null;
  hasEvidence?: boolean;
}

/**
 * Aplica una transición validada: assertTransition + evento + bump de versión.
 * Retorna el StatusEvent creado.
 */
export function applyTransitionTx(
  db: Database,
  report: Report,
  opts: TransitionTxOpts
): StatusEvent {
  assertTransition(report.state, opts.to, opts.actorRole, {
    reason: opts.reason,
    hasEvidence: opts.hasEvidence,
  });
  const event: StatusEvent = {
    id: newId(),
    reportId: report.id,
    from: report.state,
    to: opts.to,
    actorId: opts.actorId,
    reason: opts.reason?.trim() ? opts.reason.trim() : null,
    idempotencyKey: null,
    createdAt: nowIso(),
  };
  put(db, "statusEvents", event);
  report.state = opts.to;
  report.version += 1;
  report.updatedAt = nowIso();
  return event;
}

/**
 * Alcance para transiciones: los roles institucionales solo operan en su
 * comuna. Ciudadanos, moderación y admin no pasan por este chequeo aquí
 * (la verificación es pública; la moderación es global por diseño).
 */
export function assertInstitutionalScope(actor: Actor, municipalityId: string): void {
  if (isInstitutionalRole(actor.role) && !inScope(actor, municipalityId)) {
    throw new DomainError(
      "SCOPE_FORBIDDEN",
      "Este reporte pertenece a otra comuna fuera de tu alcance"
    );
  }
}

/** ¿El actor puede ver la ubicación exacta de este reporte? */
export function canSeeExactLocation(
  actor: Actor | null,
  report: Report
): boolean {
  if (!actor) return false;
  if (actor.id === report.authorId) return true;
  if (actor.role === "PLATFORM_ADMIN" || actor.role === "INDEPENDENT_MODERATOR")
    return true;
  if (isInstitutionalRole(actor.role)) {
    // Alcance = comuna del reporte en sus comunas autorizadas.
    return actor.municipalityIds.includes(report.municipalityId);
  }
  return false;
}

/** Nombre de organización o null. */
export function orgRef(
  db: Database,
  orgId: string | null
): { id: string; name: string } | null {
  if (!orgId) return null;
  const org = get<Organization>(db, "organizations", orgId);
  if (!org) return null;
  return { id: org.id, name: org.name };
}

/**
 * Regla "Ya estuvo la Muni" (iteración 1, hallazgo 3).
 *
 * El sello se otorga SOLO cuando se cumplen las tres condiciones juntas:
 * 1. El reporte está VERIFIED_RESOLVED.
 * 2. Existe al menos una acción municipal acreditable causal.
 * 3. La acción ocurrió a más tardar cuando se informó la solución
 *    (evento SOLUTION_PROPOSED): la gestión debe ser causa, no decoración
 *    posterior.
 *
 * NO otorgan crédito por sí solos: ACKNOWLEDGED, una respuesta pública, la
 * mera existencia de managingOrgId, una asignación sin acción posterior ni
 * una derivación sin seguimiento.
 */
export function reportMunicipalCredit(db: Database, report: Report): boolean {
  if (report.state !== "VERIFIED_RESOLVED") return false;
  return causalMunicipalActions(db, report).length > 0;
}

/** Marca temporal del primer evento SOLUTION_PROPOSED (solución informada). */
function solutionInformedAt(db: Database, reportId: string): string | null {
  const events = all<StatusEvent>(db, "statusEvents")
    .filter((e) => e.reportId === reportId && e.to === "SOLUTION_PROPOSED")
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  return events[0]?.createdAt ?? null;
}

/**
 * Acciones municipales acreditables causales: registradas por una
 * municipalidad y con fecha no posterior a la solución informada.
 */
export function causalMunicipalActions(
  db: Database,
  report: Report
): MunicipalAction[] {
  const informedAt = solutionInformedAt(db, report.id);
  if (!informedAt) return [];
  return all<MunicipalAction>(db, "municipalActions")
    .filter((a) => a.reportId === report.id && a.createdAt <= informedAt)
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
}

function formatDateCl(iso: string): string {
  return new Date(iso).toLocaleDateString("es-CL", {
    day: "numeric",
    month: "numeric",
    year: "numeric",
  });
}

/**
 * Construye la explicación estructurada de atribución del reporte:
 * responsable, gestor, ejecutor, verificación y detalle del crédito
 * municipal. Es lo que la interfaz pública muestra para explicar por qué
 * (o por qué no) la municipalidad recibió el reconocimiento.
 */
export function buildAttribution(db: Database, report: Report): Attribution {
  const actions = causalMunicipalActions(db, report);
  const granted = report.state === "VERIFIED_RESOLVED" && actions.length > 0;

  // Cómo se verificó: auditoría de la resolución (o votos, para datos históricos).
  let verification: Attribution["verification"] = null;
  if (report.state === "VERIFIED_RESOLVED") {
    const resolutionAudit = all<AuditEvent>(db, "auditEvents").find(
      (e) => e.entityId === report.id && e.action === "report.verification_resolved"
    );
    const via = resolutionAudit?.detail?.["via"] as
      | "author-plus-neighbor"
      | "community"
      | undefined;
    const approvingVoterIds =
      (resolutionAudit?.detail?.["approvingVoterIds"] as string[] | undefined) ??
      [];
    if (via) {
      verification = {
        mode: via,
        approvers: approvingVoterIds.length,
        at: resolutionAudit?.createdAt ?? null,
      };
    } else {
      // Datos históricos (seed demo): derivar de los votos registrados.
      const votes = all<{ reportId: string; voterId: string; approve: boolean }>(
        db,
        "verificationVotes"
      ).filter((v) => v.reportId === report.id && v.approve);
      const approvers = votes
        .map((v) => v.voterId)
        .filter((id, i, arr) => arr.indexOf(id) === i);
      if (approvers.length > 0) {
        verification = {
          mode: approvers.includes(report.authorId)
            ? "author-plus-neighbor"
            : "community",
          approvers: approvers.length,
          at: null,
        };
      }
    }
  }

  const users = new Map(
    all<User>(db, "users").map((u) => [u.id, u.displayName])
  );
  const actionDtos = actions.map((a) => ({
    type: a.type,
    typeLabel: MUNICIPAL_ACTION_LABELS[a.type],
    organizationName: orgRef(db, a.organizationId)?.name ?? "Municipalidad",
    actorName: users.get(a.actorId) ?? "Funcionario/a",
    at: a.createdAt,
    publicDescription: a.publicDescription,
  }));

  const managingName = orgRef(db, report.managingOrgId)?.name;
  let headline: string;
  let explanation: string;
  if (granted) {
    const first = actionDtos[0];
    headline = "Ya estuvo la Muni";
    explanation =
      `Ya estuvo la Muni: ${first.organizationName} — ` +
      `${first.typeLabel.toLowerCase()} el ${formatDateCl(first.at)} ` +
      `(${first.publicDescription}) y la solución fue verificada por la ciudadanía.`;
  } else if (report.state === "VERIFIED_RESOLVED") {
    headline = "Problema resuelto";
    explanation =
      "Problema resuelto: la solución fue verificada por la ciudadanía, " +
      "pero no hay gestión municipal acreditable registrada" +
      (managingName ? ` por ${managingName}` : "") +
      ".";
  } else {
    headline = "";
    explanation = "";
  }

  return {
    responsible: orgRef(db, report.responsibleOrgId),
    managing: orgRef(db, report.managingOrgId),
    executor: orgRef(db, report.executorOrgId),
    verification,
    municipalCredit: { granted, headline, explanation, actions: actionDtos },
  };
}

/** Construye el DTO público/privilegiado de un reporte. */
export function toReportDto(
  db: Database,
  report: Report,
  actor: Actor | null
): ReportDto {
  const category = get<Category>(db, "categories", report.categoryId);
  const municipality = get<Municipality>(db, "municipalities", report.municipalityId);
  const author = get<User>(db, "users", report.authorId);
  const duplicates = all<PossibleDuplicate>(db, "possibleDuplicates")
    .filter((d) => d.reportId === report.id)
    .map((d) => get<Report>(db, "reports", d.candidateReportId)?.code)
    .filter((c): c is string => typeof c === "string");

  const confirmedByMe = actor
    ? all<Confirmation>(db, "confirmations").some(
        (c) => c.reportId === report.id && c.userId === actor.id
      )
    : false;
  const following = actor
    ? all<Follower>(db, "followers").some(
        (f) => f.reportId === report.id && f.userId === actor.id
      )
    : false;

  const anonymous = report.anonymousPublic && !canSeeExactLocation(actor, report);
  const dto: ReportDto = {
    code: report.code,
    title: report.title,
    description: report.description,
    category: {
      id: category?.id ?? report.categoryId,
      name: category?.name ?? "Sin categoría",
      icon: category?.icon ?? "report",
    },
    municipality: {
      id: municipality?.id ?? report.municipalityId,
      name: municipality?.name ?? "—",
    },
    state: report.state,
    stateLabel: REPORT_STATE_LABELS[report.state],
    stateGroup: REPORT_STATE_GROUPS[report.state],
    publicLocation: report.publicLocation,
    author: {
      displayName: anonymous ? "Vecino/a" : (author?.displayName ?? "Vecino/a"),
      verifiedResident: author?.verifiedResident ?? false,
    },
    confirmationsCount: report.confirmationsCount,
    followersCount: report.followersCount,
    confirmedByMe,
    following,
    responsibleOrg: orgRef(db, report.responsibleOrgId),
    managingOrg: orgRef(db, report.managingOrgId),
    executorOrg: orgRef(db, report.executorOrgId),
    municipalCredit: reportMunicipalCredit(db, report),
    attribution: buildAttribution(db, report),
    version: report.version,
    createdAt: report.createdAt,
    updatedAt: report.updatedAt,
    possibleDuplicates: duplicates,
  };
  if (canSeeExactLocation(actor, report)) {
    dto.location = report.location;
  }
  return dto;
}

/** Requiere actor autenticado (los servicios no leen cookies). */
export function requireActor(actor: Actor | null): Actor {
  if (!actor) {
    throw new DomainError("UNAUTHENTICATED", "Se requiere iniciar sesión");
  }
  return actor;
}
