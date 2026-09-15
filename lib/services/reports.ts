/**
 * FLM — Servicios de reportes (lógica de negocio pura, testeable sin HTTP).
 * Los Route Handlers son wrappers delgados sobre estas funciones.
 */
import { newId, nowIso, nextSequence, read, transact } from "@/lib/db/store";
import {
  DomainError,
  GeoPoint,
  Category,
  Membership,
  Organization,
  REPORT_STATE_LABELS,
  Report,
  ReportState,
  StatusEvent,
  User,
} from "@/lib/domain/types";
import { haversineMeters, formatReportCode, approximatePublicLocation } from "@/lib/domain/geo";
import {
  Actor,
  assertCapability,
  canReadInternalNotes,
  hasCapability,
  isInstitutionalRole,
} from "@/lib/domain/permissions";
import {
  evaluateVerificationQuorum,
} from "@/lib/domain/verification";
import {
  Confirmation,
  ExternalAgency,
  Follower,
  InstitutionalResponse,
  MUNICIPAL_ACTION_LABELS,
  MUNICIPAL_ACTION_TYPES,
  MunicipalAction,
  MunicipalActionType,
  Municipality,
  PossibleDuplicate,
  PublicReference,
  PublicReferenceKind,
  Referral,
  ReferralAcceptance,
  ReopenRequest,
  ReportDto,
  ReportMedia,
  ResolutionEvidence,
  TimelineItem,
  VerificationRequest,
  VerificationVote,
} from "@/lib/domain/entities";
import {
  all,
  applyTransitionTx,
  assertInstitutionalScope,
  auditTx,
  checkVersion,
  get,
  loadReportTx,
  orgRef,
  put,
  requireActor,
  resolveActionBacking,
  toReportDto,
} from "./common";
import { validateImageDataUrl } from "./media";

/** Estados que cierran el ciclo de detección de duplicados. */
const TERMINAL_STATES: ReportState[] = [
  "VERIFIED_RESOLVED",
  "REJECTED_WITH_REASON",
  "HIDDEN_BY_MODERATION",
];

const DUPLICATE_RADIUS_M = 100;

// ---------------------------------------------------------------------------
// Creación y lectura
// ---------------------------------------------------------------------------

export interface CreateReportInput {
  categoryId: string;
  municipalityId?: string;
  title: string;
  description: string;
  location: GeoPoint;
  anonymousPublic?: boolean;
  photoDataUrl?: string;
}

function resolveMunicipality(
  allMunis: Municipality[],
  input: CreateReportInput
): Municipality {
  if (input.municipalityId) {
    const m = allMunis.find((x) => x.id === input.municipalityId);
    if (!m) {
      throw new DomainError(
        "MUNICIPALITY_NOT_FOUND",
        "Comuna no encontrada"
      );
    }
    return m;
  }
  if (allMunis.length === 0) {
    throw new DomainError("MUNICIPALITY_NOT_FOUND", "No hay comunas registradas");
  }
  // Comuna más cercana al punto reportado (en PostGIS: ST_ClosestPoint).
  let best = allMunis[0];
  let bestDist = haversineMeters(input.location, best.center);
  for (const m of allMunis.slice(1)) {
    const d = haversineMeters(input.location, m.center);
    if (d < bestDist) {
      best = m;
      bestDist = d;
    }
  }
  return best;
}

export async function createReport(
  actor: Actor | null,
  input: CreateReportInput
): Promise<ReportDto> {
  const a = requireActor(actor);
  assertCapability(a.role, "report.create");

  const title = input.title.trim();
  const description = input.description.trim();
  if (title.length < 5 || description.length < 10) {
    throw new DomainError("VALIDATION", "Título o descripción demasiado cortos");
  }

  let photo: ReportMedia | null = null;
  if (input.photoDataUrl) {
    const validated = validateImageDataUrl(input.photoDataUrl);
    photo = {
      id: newId(),
      reportId: "", // se completa en la transacción
      dataUrl: validated.dataUrl,
      mimeType: validated.mimeType,
      sizeBytes: validated.sizeBytes,
      kind: "problem",
      uploadedBy: a.id,
      createdAt: nowIso(),
    };
  }

  // Secuencia fuera de la transacción principal (los huecos son aceptables).
  const muniForSeq = await read((db) =>
    resolveMunicipality(all<Municipality>(db, "municipalities"), input)
  );
  const seq = await nextSequence(`report-seq:${muniForSeq.prefix}`);
  const code = formatReportCode(muniForSeq.prefix, seq);

  const created = await transact((db) => {
    const municipality = resolveMunicipality(
      all<Municipality>(db, "municipalities"),
      input
    );
    const category = get<Category>(db, "categories", input.categoryId);
    if (!category) {
      throw new DomainError("CATEGORY_NOT_FOUND", "Categoría no encontrada");
    }

    const now = nowIso();
    const report: Report = {
      id: newId(),
      code,
      municipalityId: municipality.id,
      categoryId: category.id,
      title,
      description,
      location: { ...input.location },
      publicLocation: category.sensitiveLocation
        ? approximatePublicLocation(input.location)
        : { ...input.location },
      state: "AWAITING_RESPONSE",
      version: 1,
      authorId: a.id,
      anonymousPublic: input.anonymousPublic ?? false,
      responsibleOrgId: null,
      managingOrgId: null,
      executorOrgId: null,
      verifierId: null,
      confirmationsCount: 0,
      followersCount: 0,
      createdAt: now,
      updatedAt: now,
    };
    put(db, "reports", report);

    // Historial: REPORTED → AWAITING_RESPONSE en la misma transacción.
    const e1: StatusEvent = {
      id: newId(),
      reportId: report.id,
      from: null,
      to: "REPORTED",
      actorId: a.id,
      reason: null,
      idempotencyKey: null,
      createdAt: now,
    };
    const e2: StatusEvent = {
      id: newId(),
      reportId: report.id,
      from: "REPORTED",
      to: "AWAITING_RESPONSE",
      actorId: null, // sistema
      reason: null,
      idempotencyKey: null,
      createdAt: now,
    };
    put(db, "statusEvents", e1);
    put(db, "statusEvents", e2);

    // Detección de duplicados: misma categoría, ≤100m, estado no terminal.
    let dupes = 0;
    for (const other of all<Report>(db, "reports")) {
      if (other.id === report.id) continue;
      if (other.categoryId !== report.categoryId) continue;
      if (TERMINAL_STATES.includes(other.state)) continue;
      const dist = haversineMeters(report.location, other.location);
      if (dist <= DUPLICATE_RADIUS_M && dupes < 10) {
        const dupe: PossibleDuplicate = {
          id: newId(),
          reportId: report.id,
          candidateReportId: other.id,
          distanceMeters: Math.round(dist),
          reason: "geo-category",
          createdAt: now,
        };
        put(db, "possibleDuplicates", dupe);
        dupes += 1;
      }
    }

    if (photo) {
      photo.reportId = report.id;
      put(db, "reportMedia", photo);
    }

    auditTx(db, {
      action: "report.create",
      actorId: a.id,
      entityType: "report",
      entityId: report.id,
      detail: { code: report.code, duplicates: dupes },
    });
    return report;
  });

  const dto = await read((db) => toReportDto(db, created, a));
  return dto;
}

export async function getReportByCode(
  code: string,
  actor: Actor | null
): Promise<ReportDto> {
  return read((db) => {
    const report = loadReportTx(db, code);
    if (
      report.state === "HIDDEN_BY_MODERATION" &&
      actor?.role !== "INDEPENDENT_MODERATOR" &&
      actor?.role !== "PLATFORM_ADMIN"
    ) {
      throw new DomainError("REPORT_NOT_FOUND", `Reporte ${code} no encontrado`);
    }
    return toReportDto(db, report, actor);
  });
}

export interface ListReportsFilters {
  state?: ReportState;
  categoryId?: string;
  municipalityId?: string;
  near?: { lng: number; lat: number; radiusM: number };
  page?: number;
  pageSize?: number;
}

export async function listReports(
  filters: ListReportsFilters,
  actor: Actor | null
): Promise<{ items: ReportDto[]; total: number; page: number; pageSize: number }> {
  const page = filters.page ?? 1;
  const pageSize = Math.min(filters.pageSize ?? 20, 100);
  return read((db) => {
    let items = all<Report>(db, "reports");
    const canSeeHidden =
      actor?.role === "INDEPENDENT_MODERATOR" ||
      actor?.role === "PLATFORM_ADMIN";
    if (!canSeeHidden) {
      items = items.filter((r) => r.state !== "HIDDEN_BY_MODERATION");
    }
    if (filters.state) items = items.filter((r) => r.state === filters.state);
    if (filters.categoryId)
      items = items.filter((r) => r.categoryId === filters.categoryId);
    if (filters.municipalityId)
      items = items.filter((r) => r.municipalityId === filters.municipalityId);
    if (filters.near) {
      const { lng, lat, radiusM } = filters.near;
      items = items.filter(
        (r) => haversineMeters(r.publicLocation, { lng, lat }) <= radiusM
      );
    }
    items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    const total = items.length;
    const slice = items.slice((page - 1) * pageSize, page * pageSize);
    return {
      items: slice.map((r) => toReportDto(db, r, actor)),
      total,
      page,
      pageSize,
    };
  });
}

/** Candidatos a duplicado para un punto + categoría (panel de reporte). */
export async function findDuplicateCandidates(input: {
  lng: number;
  lat: number;
  categoryId: string;
  radiusM?: number;
}): Promise<ReportDto[]> {
  const radiusM = input.radiusM ?? DUPLICATE_RADIUS_M;
  return read((db) =>
    all<Report>(db, "reports")
      .filter((r) => r.categoryId === input.categoryId)
      .filter((r) => !TERMINAL_STATES.includes(r.state))
      .filter(
        (r) =>
          haversineMeters(r.publicLocation, { lng: input.lng, lat: input.lat }) <=
          radiusM
      )
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .slice(0, 20)
      .map((r) => toReportDto(db, r, null))
  );
}

// ---------------------------------------------------------------------------
// Confirmar / seguir
// ---------------------------------------------------------------------------

export async function confirmReport(
  actor: Actor | null,
  code: string
): Promise<{ confirmationsCount: number }> {
  const a = requireActor(actor);
  assertCapability(a.role, "report.confirm");
  return transact((db) => {
    const report = loadReportTx(db, code);
    const exists = all<Confirmation>(db, "confirmations").some(
      (c) => c.reportId === report.id && c.userId === a.id
    );
    if (exists) {
      throw new DomainError(
        "ALREADY_CONFIRMED",
        "Ya confirmaste este reporte"
      );
    }
    put<Confirmation>(db, "confirmations", {
      id: newId(),
      reportId: report.id,
      userId: a.id,
      createdAt: nowIso(),
    });
    report.confirmationsCount += 1;
    report.updatedAt = nowIso();
    auditTx(db, {
      action: "report.confirm",
      actorId: a.id,
      entityType: "report",
      entityId: report.id,
      detail: { code },
    });
    return { confirmationsCount: report.confirmationsCount };
  });
}

export async function followReport(
  actor: Actor | null,
  code: string
): Promise<{ followersCount: number }> {
  const a = requireActor(actor);
  assertCapability(a.role, "report.follow");
  return transact((db) => {
    const report = loadReportTx(db, code);
    const exists = all<Follower>(db, "followers").some(
      (f) => f.reportId === report.id && f.userId === a.id
    );
    if (exists) {
      throw new DomainError("ALREADY_FOLLOWING", "Ya sigues este reporte");
    }
    put<Follower>(db, "followers", {
      id: newId(),
      reportId: report.id,
      userId: a.id,
      createdAt: nowIso(),
    });
    report.followersCount += 1;
    report.updatedAt = nowIso();
    auditTx(db, {
      action: "report.follow",
      actorId: a.id,
      entityType: "report",
      entityId: report.id,
      detail: { code },
    });
    return { followersCount: report.followersCount };
  });
}

export async function unfollowReport(
  actor: Actor | null,
  code: string
): Promise<{ followersCount: number }> {
  const a = requireActor(actor);
  return transact((db) => {
    const report = loadReportTx(db, code);
    const existing = all<Follower>(db, "followers").find(
      (f) => f.reportId === report.id && f.userId === a.id
    );
    if (!existing) {
      throw new DomainError("NOT_FOLLOWING", "No sigues este reporte");
    }
    delete db.followers[existing.id];
    report.followersCount = Math.max(0, report.followersCount - 1);
    report.updatedAt = nowIso();
    auditTx(db, {
      action: "report.unfollow",
      actorId: a.id,
      entityType: "report",
      entityId: report.id,
      detail: { code },
    });
    return { followersCount: report.followersCount };
  });
}

// ---------------------------------------------------------------------------
// Transiciones
// ---------------------------------------------------------------------------

export interface TransitionInput {
  to: ReportState;
  reason?: string;
  expectedVersion: number;
}

export async function transitionReport(
  actor: Actor | null,
  code: string,
  input: TransitionInput
): Promise<ReportDto> {
  const a = requireActor(actor);
  // Barrera anti-suplantación (iteración 1, hallazgo 1): ningún actor HTTP
  // puede solicitar VERIFIED_RESOLVED. La resolución verificada solo la
  // ejecuta el actor interno SYSTEM tras el quórum ciudadano (voteVerification).
  // El actor de sesión jamás es SYSTEM (el tipo Actor solo admite Role), pero
  // esta guarda explícita lo hace imposible incluso ante un bypass de tipos.
  if (input.to === "VERIFIED_RESOLVED") {
    throw new DomainError(
      "FORBIDDEN",
      "La resolución verificada solo la ejecuta el sistema tras el quórum ciudadano"
    );
  }
  await transact((db) => {
    const report = loadReportTx(db, code);
    checkVersion(report, input.expectedVersion);
    assertInstitutionalScope(a, report.municipalityId);
    const hasEvidence =
      all<ResolutionEvidence>(db, "resolutionEvidence").filter(
        (e) => e.reportId === report.id
      ).length > 0;
    applyTransitionTx(db, report, {
      to: input.to,
      actorId: a.id,
      actorRole: a.role,
      reason: input.reason,
      hasEvidence,
    });
    if (input.to === "AWAITING_VERIFICATION") {
      // Rondas de verificación (iteración 1): cada entrada crea UNA ronda
      // nueva y nunca puede haber más de una abierta por reporte.
      const openRounds = all<VerificationRequest>(db, "verificationRequests").filter(
        (vr) => vr.reportId === report.id && vr.status === "open"
      );
      if (openRounds.length > 0) {
        throw new DomainError(
          "VERIFICATION_ROUND_OPEN",
          "Ya existe una ronda de verificación abierta para este reporte"
        );
      }
      // Ciclo causal de la ronda: la SOLUTION_PROPOSED que la origina y la
      // última REOPENED anterior (si existe). La consulta corre DESPUÉS de
      // aplicar la transición, pero filtra por `to`, así que el evento
      // recién creado (AWAITING_VERIFICATION) no interfiere.
      const solutionProposedAt =
        all<StatusEvent>(db, "statusEvents")
          .filter((e) => e.reportId === report.id && e.to === "SOLUTION_PROPOSED")
          .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0]?.createdAt ??
        null;
      const cycleStartAt =
        all<StatusEvent>(db, "statusEvents")
          .filter((e) => e.reportId === report.id && e.to === "REOPENED")
          .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0]?.createdAt ??
        null;
      put<VerificationRequest>(db, "verificationRequests", {
        id: newId(),
        reportId: report.id,
        requestedBy: a.id,
        status: "open",
        solutionProposedAt,
        cycleStartAt,
        createdAt: nowIso(),
      });
    }
    if (input.to === "VERIFIED_RESOLVED" || input.to === "REOPENED") {
      for (const vr of all<VerificationRequest>(db, "verificationRequests")) {
        if (vr.reportId === report.id && vr.status === "open") {
          vr.status = input.to === "VERIFIED_RESOLVED" ? "resolved" : "reopened";
        }
      }
    }
    auditTx(db, {
      action: "report.transition",
      actorId: a.id,
      entityType: "report",
      entityId: report.id,
      detail: { code, to: input.to, reason: input.reason ?? null },
    });
  });
  return getReportByCode(code, a);
}

// ---------------------------------------------------------------------------
// Verificación ciudadana / independiente
// ---------------------------------------------------------------------------

export interface VoteInput {
  approve: boolean;
  comment?: string;
}

export async function voteVerification(
  actor: Actor | null,
  code: string,
  input: VoteInput
): Promise<{
  report: ReportDto;
  votes: VerificationVote[];
  resolved: boolean;
  via: "author-plus-neighbor" | "community" | null;
}> {
  const a = requireActor(actor);
  // Elegibilidad: fuente única = matriz de capacidades. Solo RESIDENT y
  // VERIFIED_RESIDENT tienen "report.verify". Moderación, administración y
  // roles institucionales reciben FORBIDDEN (→ 403 en la API).
  assertCapability(a.role, "report.verify");
  const comment = input.comment?.trim() ?? "";

  const result = await transact((db) => {
    const report = loadReportTx(db, code);
    if (report.state !== "AWAITING_VERIFICATION") {
      throw new DomainError(
        "NOT_IN_VERIFICATION",
        "El reporte no está en verificación"
      );
    }

    // Independencia: las cuentas vinculadas a la organización gestora o
    // ejecutora no pueden votar como ciudadanía (conflicto de interés).
    const managedOrgIds = new Set(
      [report.managingOrgId, report.executorOrgId].filter(
        (x): x is string => x !== null
      )
    );
    const orgsByUser = new Map<string, Set<string>>();
    for (const m of all<Membership>(db, "memberships")) {
      if (!orgsByUser.has(m.userId)) orgsByUser.set(m.userId, new Set());
      orgsByUser.get(m.userId)!.add(m.organizationId);
    }
    const isLinkedToManagedOrg = (userId: string): boolean => {
      if (managedOrgIds.size === 0) return false;
      const orgs = orgsByUser.get(userId);
      if (!orgs) return false;
      let linked = false;
      orgs.forEach((o) => {
        if (managedOrgIds.has(o)) linked = true;
      });
      return linked;
    };
    if (isLinkedToManagedOrg(a.id)) {
      throw new DomainError(
        "FORBIDDEN",
        "Las cuentas vinculadas a la organización gestora o ejecutora no pueden votar como ciudadanía"
      );
    }

    // Rondas de verificación (iteración 1): el voto pertenece a LA única
    // ronda abierta, no al reporte. El quórum se evalúa solo con votos de
    // esa ronda y la unicidad es voterId + verificationRequestId: quien votó
    // en una ronda anterior puede votar de nuevo en una ronda nueva.
    const openRounds = all<VerificationRequest>(db, "verificationRequests").filter(
      (vr) => vr.reportId === report.id && vr.status === "open"
    );
    if (openRounds.length === 0) {
      throw new DomainError(
        "NO_OPEN_VERIFICATION_ROUND",
        "No hay una ronda de verificación abierta para este reporte"
      );
    }
    if (openRounds.length > 1) {
      throw new DomainError(
        "MULTIPLE_OPEN_ROUNDS",
        "Integridad comprometida: más de una ronda de verificación abierta"
      );
    }
    const round = openRounds[0];

    const existing = all<VerificationVote>(db, "verificationVotes").filter(
      (v) => v.verificationRequestId === round.id
    );
    if (existing.some((v) => v.voterId === a.id)) {
      throw new DomainError(
        "DUPLICATE_VOTE",
        "Ya votaste en esta ronda de verificación"
      );
    }

    const isAuthor = report.authorId === a.id;
    const vote: VerificationVote = {
      id: newId(),
      reportId: report.id,
      verificationRequestId: round.id,
      voterId: a.id,
      voterRole: a.role,
      approve: input.approve,
      comment: comment ? comment : null,
      weight: 1,
      createdAt: nowIso(),
    };
    put(db, "verificationVotes", vote);
    auditTx(db, {
      action: "report.verification_vote",
      actorId: a.id,
      entityType: "report",
      entityId: report.id,
      detail: { code, approve: input.approve, verificationRequestId: round.id },
    });

    let resolved = false;
    let via: "author-plus-neighbor" | "community" | null = null;
    const votes = [...existing, vote];

    if (!input.approve) {
      // Solo el autor puede reabrir con un rechazo; exige fundamento.
      // El disenso de otros vecinos queda registrado como opinión visible.
      if (!isAuthor) {
        return { votes, resolved, via };
      }
      if (!comment) {
        throw new DomainError(
          "REASON_REQUIRED",
          "Rechazar la solución requiere explicar el motivo"
        );
      }
      put<ReopenRequest>(db, "reopenRequests", {
        id: newId(),
        reportId: report.id,
        requestedBy: a.id,
        reason: comment,
        status: "accepted",
        createdAt: nowIso(),
      });
      // La ronda se cierra atómicamente con el rechazo (igual que en la
      // resolución SYSTEM): una ronda cerrada jamás recibe más votos ni
      // puede volver a resolverse.
      round.status = "reopened";
      put<VerificationRequest>(db, "verificationRequests", round);
      applyTransitionTx(db, report, {
        to: "REOPENED",
        actorId: a.id,
        actorRole: a.role,
        reason: comment,
      });
      auditTx(db, {
        action: "report.transition",
        actorId: a.id,
        entityType: "report",
        entityId: report.id,
        detail: { code, to: "REOPENED", via: "verification_vote" },
      });
      return { votes, resolved, via };
    }

    // Aprobación: evaluar el quórum y, si se alcanza, transicionar a
    // VERIFIED_RESOLVED con actor SYSTEM EN LA MISMA TRANSACCIÓN.
    const users = new Map(all<User>(db, "users").map((u) => [u.id, u]));
    const evaluation = evaluateVerificationQuorum(
      report.authorId,
      votes.map((v) => ({
        voterId: v.voterId,
        approve: v.approve,
        verifiedResident: users.get(v.voterId)?.verifiedResident ?? false,
        linkedToManagingOrg: isLinkedToManagedOrg(v.voterId),
      }))
    );

    if (evaluation.resolved) {
      resolved = true;
      via = evaluation.via;
      if (via === "author-plus-neighbor") {
        report.verifierId = report.authorId;
      }
      applyTransitionTx(db, report, {
        to: "VERIFIED_RESOLVED",
        actorId: null, // sistema: nadie puede suplantarlo por HTTP
        actorRole: "SYSTEM",
        reason: null,
      });
      for (const vr of all<VerificationRequest>(db, "verificationRequests")) {
        if (vr.reportId === report.id && vr.status === "open") {
          vr.status = "resolved";
        }
      }
      // La resolución registra los votos que activaron la decisión.
      auditTx(db, {
        action: "report.verification_resolved",
        actorId: null,
        entityType: "report",
        entityId: report.id,
        detail: {
          code,
          via,
          approvingVoterIds: evaluation.approvingVoterIds,
        },
      });
    }
    return { votes, resolved, via };
  });

  const dto = await read((db) => toReportDto(db, loadReportTx(db, code), a));
  return {
    report: dto,
    votes: result.votes,
    resolved: result.resolved,
    via: result.via,
  };
}

// ---------------------------------------------------------------------------
// Evidencia, respuestas, notas internas
// ---------------------------------------------------------------------------

export async function addEvidence(
  actor: Actor | null,
  code: string,
  input: { dataUrl: string; description?: string; kind: "problem" | "solution" }
): Promise<ResolutionEvidence> {
  const a = requireActor(actor);
  const validated = validateImageDataUrl(input.dataUrl);
  return transact((db) => {
    const report = loadReportTx(db, code);
    const isAuthor = report.authorId === a.id;
    const canInstitutional =
      hasCapability(a.role, "institutional.propose_solution") &&
      a.municipalityIds.includes(report.municipalityId);
    if (!isAuthor && !canInstitutional) {
      throw new DomainError(
        "FORBIDDEN",
        "Solo el autor o la institución a cargo pueden adjuntar evidencia"
      );
    }
    const media: ReportMedia = {
      id: newId(),
      reportId: report.id,
      dataUrl: validated.dataUrl,
      mimeType: validated.mimeType,
      sizeBytes: validated.sizeBytes,
      kind: input.kind,
      uploadedBy: a.id,
      createdAt: nowIso(),
    };
    put(db, "reportMedia", media);
    const evidence: ResolutionEvidence = {
      id: newId(),
      reportId: report.id,
      mediaId: media.id,
      description: input.description?.trim() || null,
      uploadedBy: a.id,
      createdAt: nowIso(),
    };
    put(db, "resolutionEvidence", evidence);
    report.updatedAt = nowIso();
    auditTx(db, {
      action: "report.add_evidence",
      actorId: a.id,
      entityType: "report",
      entityId: report.id,
      detail: { code, kind: input.kind, mimeType: validated.mimeType },
    });
    return evidence;
  });
}

export async function addPublicResponse(
  actor: Actor | null,
  code: string,
  input: { message: string }
): Promise<InstitutionalResponse> {
  const a = requireActor(actor);
  assertCapability(a.role, "institutional.respond_public");
  const message = input.message.trim();
  if (!message) throw new DomainError("VALIDATION", "El mensaje no puede estar vacío");
  return transact((db) => {
    const report = loadReportTx(db, code);
    assertInstitutionalScope(a, report.municipalityId);
    if (!a.organizationId) {
      throw new DomainError("FORBIDDEN", "Sin organización asociada");
    }
    const response: InstitutionalResponse = {
      id: newId(),
      reportId: report.id,
      organizationId: a.organizationId,
      actorId: a.id,
      kind: "response",
      internal: false,
      message,
      createdAt: nowIso(),
    };
    put(db, "institutionalResponses", response);
    auditTx(db, {
      action: "report.public_response",
      actorId: a.id,
      entityType: "report",
      entityId: report.id,
      detail: { code },
    });
    return response;
  });
}

export async function addInternalNote(
  actor: Actor | null,
  code: string,
  input: { message: string }
): Promise<InstitutionalResponse> {
  const a = requireActor(actor);
  const message = input.message.trim();
  if (!message) throw new DomainError("VALIDATION", "La nota no puede estar vacía");
  return transact((db) => {
    const report = loadReportTx(db, code);
    assertInstitutionalScope(a, report.municipalityId);
    if (!a.organizationId || !canReadInternalNotes(a, a.organizationId)) {
      throw new DomainError(
        "FORBIDDEN",
        "Solo miembros de la organización pueden escribir notas internas"
      );
    }
    const note: InstitutionalResponse = {
      id: newId(),
      reportId: report.id,
      organizationId: a.organizationId,
      actorId: a.id,
      kind: "note",
      internal: true,
      message,
      createdAt: nowIso(),
    };
    put(db, "institutionalResponses", note);
    auditTx(db, {
      action: "report.internal_note",
      actorId: a.id,
      entityType: "report",
      entityId: report.id,
      detail: { code },
    });
    return note;
  });
}

export async function listInternalNotes(
  actor: Actor | null,
  code: string
): Promise<InstitutionalResponse[]> {
  const a = requireActor(actor);
  return read((db) => {
    const report = loadReportTx(db, code);
    assertInstitutionalScope(a, report.municipalityId);
    if (!a.organizationId || !canReadInternalNotes(a, a.organizationId)) {
      throw new DomainError(
        "FORBIDDEN",
        "Solo miembros de la organización pueden leer notas internas"
      );
    }
    return all<InstitutionalResponse>(db, "institutionalResponses")
      .filter(
        (r) =>
          r.reportId === report.id &&
          r.internal &&
          r.organizationId === a.organizationId
      )
      .sort((x, y) => (x.createdAt < y.createdAt ? -1 : 1));
  });
}

// ---------------------------------------------------------------------------
// Asignación y derivación
// ---------------------------------------------------------------------------

export async function assignDepartment(
  actor: Actor | null,
  code: string,
  input: { departmentId: string; expectedVersion: number }
): Promise<ReportDto> {
  const a = requireActor(actor);
  assertCapability(a.role, "institutional.assign");
  await transact((db) => {
    const report = loadReportTx(db, code);
    checkVersion(report, input.expectedVersion);
    assertInstitutionalScope(a, report.municipalityId);
    const dept = get<{ id: string; municipalityId: string }>(
      db,
      "departments",
      input.departmentId
    );
    if (!dept || dept.municipalityId !== report.municipalityId) {
      throw new DomainError(
        "DEPARTMENT_NOT_FOUND",
        "Departamento no encontrado en esta comuna"
      );
    }
    put(db, "assignments", {
      id: newId(),
      reportId: report.id,
      departmentId: dept.id,
      assignedBy: a.id,
      createdAt: nowIso(),
    });
    applyTransitionTx(db, report, {
      to: "ASSIGNED",
      actorId: a.id,
      actorRole: a.role,
      reason: null,
    });
    auditTx(db, {
      action: "report.assign",
      actorId: a.id,
      entityType: "report",
      entityId: report.id,
      detail: { code, departmentId: dept.id },
    });
  });
  return getReportByCode(code, a);
}

export async function referToAgency(
  actor: Actor | null,
  code: string,
  input: { agencyId: string; reason: string; expectedVersion: number }
): Promise<ReportDto> {
  const a = requireActor(actor);
  assertCapability(a.role, "institutional.refer");
  const reason = input.reason.trim();
  if (!reason) throw new DomainError("VALIDATION", "La derivación requiere fundamento");
  await transact((db) => {
    const report = loadReportTx(db, code);
    checkVersion(report, input.expectedVersion);
    assertInstitutionalScope(a, report.municipalityId);
    const agency = get<ExternalAgency>(db, "externalAgencies", input.agencyId);
    if (!agency) {
      throw new DomainError("AGENCY_NOT_FOUND", "Agencia externa no encontrada");
    }
    put(db, "referrals", {
      id: newId(),
      reportId: report.id,
      agencyId: agency.id,
      reason,
      createdBy: a.id,
      createdAt: nowIso(),
    });
    applyTransitionTx(db, report, {
      to: "REFERRED",
      actorId: a.id,
      actorRole: a.role,
      reason,
    });
    auditTx(db, {
      action: "report.refer",
      actorId: a.id,
      entityType: "report",
      entityId: report.id,
      detail: { code, agencyId: agency.id, reason },
    });
  });
  return getReportByCode(code, a);
}

// ---------------------------------------------------------------------------
// Acciones municipales acreditables (iteración 1: respaldo verificable +
// causalidad por ciclo)
// ---------------------------------------------------------------------------

/** Tipos que exigen una ResolutionEvidence del mismo reporte. */
const EVIDENCE_BACKED_TYPES: MunicipalActionType[] = [
  "FIELD_WORK_RECORDED",
  "CONTRACTOR_ACTION_RECORDED",
  "SOLUTION_EVIDENCE_SUBMITTED",
];
/** Tipos que exigen una PublicReference modelada y validada del mismo reporte. */
const REFERENCE_BACKED_TYPES: MunicipalActionType[] = [
  "EXTERNAL_COORDINATION_RECORDED",
  "FOLLOW_UP_RECORDED",
];

/**
 * La organización que registra debe ser una municipalidad verificada y, o
 * bien la gestora del reporte, o bien la municipalidad de la comuna del
 * reporte. Una afirmación institucional sin este anclaje no acredita nada.
 */
function assertMunicipalActionOrg(
  db: Parameters<typeof get>[0],
  org: Organization,
  report: Report
): void {
  if (!org.verified) {
    throw new DomainError(
      "FORBIDDEN",
      "La organización no está verificada como municipalidad"
    );
  }
  const isManaging = report.managingOrgId !== null && org.id === report.managingOrgId;
  const isComunaMunicipality =
    org.municipalityId !== null && org.municipalityId === report.municipalityId;
  if (!isManaging && !isComunaMunicipality) {
    throw new DomainError(
      "FORBIDDEN",
      "La organización no es la gestora del reporte ni la municipalidad de la comuna"
    );
  }
}

/**
 * Valida el respaldo verificable de una acción municipal. `evidenceRef` no
 * puede ser un string arbitrario: debe referenciar un registro existente
 * del MISMO reporte, del tipo que corresponda a la acción.
 */
function validateActionBacking(
  db: Parameters<typeof get>[0],
  report: Report,
  type: MunicipalActionType,
  evidenceRef: string | undefined
): string {
  const ref = evidenceRef?.trim() || null;
  if (!ref) {
    throw new DomainError(
      "BACKING_REQUIRED",
      `La acción ${type} requiere un respaldo verificable: no basta la descripción`
    );
  }
  if (EVIDENCE_BACKED_TYPES.includes(type)) {
    const ev = get<ResolutionEvidence>(db, "resolutionEvidence", ref);
    if (!ev) {
      throw new DomainError("BACKING_NOT_FOUND", "La evidencia indicada no existe");
    }
    if (ev.reportId !== report.id) {
      throw new DomainError(
        "BACKING_MISMATCH",
        "La evidencia pertenece a otro reporte"
      );
    }
    return ref;
  }
  if (type === "REFERRAL_ACCEPTED_BY_AGENCY") {
    const acc = get<ReferralAcceptance>(db, "referralAcceptances", ref);
    if (!acc) {
      throw new DomainError(
        "BACKING_NOT_FOUND",
        "La aceptación de derivación indicada no existe"
      );
    }
    if (acc.reportId !== report.id) {
      throw new DomainError(
        "BACKING_MISMATCH",
        "La aceptación pertenece a otro reporte"
      );
    }
    const referral = get<Referral>(db, "referrals", acc.referralId);
    if (!referral || referral.reportId !== report.id) {
      throw new DomainError(
        "BACKING_MISMATCH",
        "La aceptación no corresponde a una derivación de este reporte"
      );
    }
    if (!acc.accepted) {
      throw new DomainError(
        "INVALID_BACKING",
        "La agencia no aceptó la derivación: no acredita gestión"
      );
    }
    return ref;
  }
  // EXTERNAL_COORDINATION_RECORDED / FOLLOW_UP_RECORDED
  const pub = get<PublicReference>(db, "publicReferences", ref);
  if (!pub) {
    throw new DomainError(
      "BACKING_NOT_FOUND",
      "La referencia pública indicada no existe"
    );
  }
  if (pub.reportId !== report.id) {
    throw new DomainError(
      "BACKING_MISMATCH",
      "La referencia pertenece a otro reporte"
    );
  }
  return ref;
}

export interface MunicipalActionInput {
  type: MunicipalActionType;
  publicDescription: string;
  evidenceRef?: string;
}

/**
 * Registra una acción municipal acreditable: el único mecanismo que puede
 * sustentar el sello "Ya estuvo la Muni".
 *
 * Una acción es una afirmación institucional: solo otorga crédito si trae
 * respaldo público verificable validado (evidenceRef existente del mismo
 * reporte). Sin respaldo válido se rechaza: una municipalidad no puede
 * concederse el sello con una declaración sin respaldo.
 */
export async function recordMunicipalAction(
  actor: Actor | null,
  code: string,
  input: MunicipalActionInput
): Promise<MunicipalAction> {
  const a = requireActor(actor);
  assertCapability(a.role, "institutional.propose_solution");
  const description = input.publicDescription.trim();
  if (description.length < 5) {
    throw new DomainError(
      "VALIDATION",
      "La descripción pública de la acción es muy corta"
    );
  }
  if (!MUNICIPAL_ACTION_TYPES.includes(input.type)) {
    throw new DomainError("VALIDATION", "Tipo de acción municipal inválido");
  }
  return transact((db) => {
    const report = loadReportTx(db, code);
    assertInstitutionalScope(a, report.municipalityId);
    if (!a.organizationId) {
      throw new DomainError("FORBIDDEN", "Sin organización asociada");
    }
    const org = get<Organization>(db, "organizations", a.organizationId);
    if (!org || org.kind !== "MUNICIPALITY") {
      throw new DomainError(
        "FORBIDDEN",
        "Solo una municipalidad puede registrar acciones municipales acreditables"
      );
    }
    assertMunicipalActionOrg(db, org, report);
    const backingRef = validateActionBacking(db, report, input.type, input.evidenceRef);
    const action: MunicipalAction = {
      id: newId(),
      reportId: report.id,
      organizationId: org.id,
      actorId: a.id,
      type: input.type,
      publicDescription: description,
      evidenceRef: backingRef,
      accredited: true,
      createdAt: nowIso(),
    };
    put(db, "municipalActions", action);
    report.updatedAt = nowIso();
    auditTx(db, {
      action: "report.municipal_action",
      actorId: a.id,
      entityType: "report",
      entityId: report.id,
      detail: {
        code,
        type: input.type,
        organizationId: org.id,
        evidenceRef: action.evidenceRef,
        accredited: true,
      },
    });
    return action;
  });
}

export interface PublicReferenceInput {
  kind: PublicReferenceKind;
  reference: string;
  summary: string;
}

/**
 * Registra una referencia pública verificable (documento oficial, registro
 * o URL pública) que puede respaldar acciones de coordinación y
 * seguimiento. La referencia es modelada y validada: no es texto libre.
 */
export async function registerPublicReference(
  actor: Actor | null,
  code: string,
  input: PublicReferenceInput
): Promise<PublicReference> {
  const a = requireActor(actor);
  assertCapability(a.role, "institutional.propose_solution");
  const kinds: PublicReferenceKind[] = ["document", "url", "registry"];
  if (!kinds.includes(input.kind)) {
    throw new DomainError("VALIDATION", "Tipo de referencia inválido");
  }
  const reference = input.reference.trim();
  if (input.kind === "url") {
    let valid = false;
    try {
      const u = new URL(reference);
      valid = u.protocol === "http:" || u.protocol === "https:";
    } catch {
      valid = false;
    }
    if (!valid) {
      throw new DomainError(
        "VALIDATION",
        "La referencia debe ser una URL pública válida (http/https)"
      );
    }
  } else if (reference.length < 3) {
    throw new DomainError(
      "VALIDATION",
      "La referencia del documento o registro es muy corta"
    );
  }
  const summary = input.summary.trim();
  if (summary.length < 5) {
    throw new DomainError(
      "VALIDATION",
      "El resumen de la referencia es muy corto"
    );
  }
  return transact((db) => {
    const report = loadReportTx(db, code);
    assertInstitutionalScope(a, report.municipalityId);
    if (!a.organizationId) {
      throw new DomainError("FORBIDDEN", "Sin organización asociada");
    }
    const org = get<Organization>(db, "organizations", a.organizationId);
    if (!org || org.kind !== "MUNICIPALITY") {
      throw new DomainError(
        "FORBIDDEN",
        "Solo una municipalidad puede registrar referencias públicas"
      );
    }
    assertMunicipalActionOrg(db, org, report);
    const ref: PublicReference = {
      id: newId(),
      reportId: report.id,
      kind: input.kind,
      reference,
      summary,
      organizationId: org.id,
      actorId: a.id,
      createdAt: nowIso(),
    };
    put(db, "publicReferences", ref);
    auditTx(db, {
      action: "report.public_reference",
      actorId: a.id,
      entityType: "report",
      entityId: report.id,
      detail: { code, kind: input.kind, reference },
    });
    return ref;
  });
}

export interface ReferralAcceptanceInput {
  referralId: string;
  accepted: boolean;
  message: string;
}

/**
 * La agencia receptora registra su aceptación o respuesta a una
 * derivación. Es el respaldo que permite acreditar
 * REFERRAL_ACCEPTED_BY_AGENCY: lo emite la agencia, no la municipalidad.
 */
export async function recordReferralAcceptance(
  actor: Actor | null,
  code: string,
  input: ReferralAcceptanceInput
): Promise<ReferralAcceptance> {
  const a = requireActor(actor);
  assertCapability(a.role, "institutional.respond_referral");
  const message = input.message.trim();
  if (message.length < 5) {
    throw new DomainError(
      "VALIDATION",
      "La respuesta de la agencia es muy corta"
    );
  }
  return transact((db) => {
    const report = loadReportTx(db, code);
    assertInstitutionalScope(a, report.municipalityId);
    const referral = get<Referral>(db, "referrals", input.referralId);
    if (!referral || referral.reportId !== report.id) {
      throw new DomainError(
        "REFERRAL_NOT_FOUND",
        "Derivación no encontrada en este reporte"
      );
    }
    const agency = get<ExternalAgency>(db, "externalAgencies", referral.agencyId);
    if (!agency) {
      throw new DomainError("AGENCY_NOT_FOUND", "Agencia externa no encontrada");
    }
    if (!a.organizationId || a.organizationId !== agency.organizationId) {
      throw new DomainError(
        "FORBIDDEN",
        "Solo la agencia receptora puede responder su derivación"
      );
    }
    const already = all<ReferralAcceptance>(db, "referralAcceptances").some(
      (x) => x.referralId === referral.id
    );
    if (already) {
      throw new DomainError(
        "ALREADY_ANSWERED",
        "Esta derivación ya tiene una respuesta registrada"
      );
    }
    const acceptance: ReferralAcceptance = {
      id: newId(),
      reportId: report.id,
      referralId: referral.id,
      agencyId: agency.id,
      organizationId: agency.organizationId,
      actorId: a.id,
      accepted: input.accepted,
      message,
      createdAt: nowIso(),
    };
    put(db, "referralAcceptances", acceptance);
    auditTx(db, {
      action: "report.referral_acceptance",
      actorId: a.id,
      entityType: "report",
      entityId: report.id,
      detail: {
        code,
        referralId: referral.id,
        agencyId: agency.id,
        accepted: input.accepted,
      },
    });
    return acceptance;
  });
}

// ---------------------------------------------------------------------------
// Timeline público
// ---------------------------------------------------------------------------

export async function getTimeline(
  code: string,
  actor: Actor | null
): Promise<TimelineItem[]> {
  // Valida visibilidad (ocultos solo para moderación/admin).
  await getReportByCode(code, actor);
  return read((db) => {
    const report = loadReportTx(db, code);
    const items: TimelineItem[] = [];

    const events = all<StatusEvent>(db, "statusEvents")
      .filter((e) => e.reportId === report.id)
      .sort((x, y) => (x.createdAt < y.createdAt ? -1 : 1));
    // El evento inicial REPORTED (from null) no aporta al timeline público.
    for (const e of events) {
      if (e.from === null) continue;
      items.push({
        type: "status",
        at: e.createdAt,
        from: e.from,
        to: e.to,
        toLabel: REPORT_STATE_LABELS[e.to],
        reason: e.reason,
        actorRole: null,
      });
    }

    for (const r of all<InstitutionalResponse>(db, "institutionalResponses").filter(
      (x) => x.reportId === report.id && !x.internal
    )) {
      const org = get<{ name: string }>(db, "organizations", r.organizationId);
      items.push({
        type: "response",
        at: r.createdAt,
        message: r.message,
        organizationName: org?.name ?? "Institución",
      });
    }

    const mediaById = new Map(
      all<ReportMedia>(db, "reportMedia").map((m) => [m.id, m])
    );
    for (const e of all<ResolutionEvidence>(db, "resolutionEvidence").filter(
      (x) => x.reportId === report.id
    )) {
      const media = mediaById.get(e.mediaId);
      if (!media) continue;
      items.push({
        type: "evidence",
        at: e.createdAt,
        mediaId: media.id,
        mimeType: media.mimeType,
        kind: media.kind,
        description: e.description,
      });
    }

    const users = new Map(all<{ id: string; displayName: string }>(db, "users").map((u) => [u.id, u.displayName]));
    for (const v of all<VerificationVote>(db, "verificationVotes").filter(
      (x) => x.reportId === report.id
    )) {
      items.push({
        type: "vote",
        at: v.createdAt,
        approve: v.approve,
        weight: v.weight,
        comment: v.comment,
        voterDisplay: users.get(v.voterId) ?? "Vecino/a",
      });
    }

    // Acciones municipales con su respaldo público verificable. Solo campos
    // públicos: jamás se exponen notas internas en el timeline.
    for (const ma of all<MunicipalAction>(db, "municipalActions").filter(
      (x) => x.reportId === report.id
    )) {
      const org = get<{ name: string }>(db, "organizations", ma.organizationId);
      items.push({
        type: "municipal-action",
        at: ma.createdAt,
        actionType: ma.type,
        typeLabel: MUNICIPAL_ACTION_LABELS[ma.type],
        organizationName: org?.name ?? "Municipalidad",
        actorName: users.get(ma.actorId) ?? "Funcionario/a",
        publicDescription: ma.publicDescription,
        accredited: ma.accredited,
        backing: resolveActionBacking(db, ma),
      });
    }

    items.sort((x, y) => (x.at < y.at ? -1 : 1));
    return items;
  });
}
