/**
 * FLM — Servicios de reportes (lógica de negocio pura, testeable sin HTTP).
 * Los Route Handlers son wrappers delgados sobre estas funciones.
 */
import { newId, nowIso, nextSequence, read, transact } from "@/lib/db/store";
import {
  DomainError,
  GeoPoint,
  Category,
  REPORT_STATE_LABELS,
  Report,
  ReportState,
  StatusEvent,
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
  Confirmation,
  ExternalAgency,
  Follower,
  InstitutionalResponse,
  Municipality,
  PossibleDuplicate,
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
  put,
  requireActor,
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

/** Quorum de verificación ciudadana (env FLM_VERIFICATION_QUORUM, default 3). */
export function verificationQuorum(): number {
  const raw = process.env.FLM_VERIFICATION_QUORUM;
  const n = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n >= 1 ? n : 3;
}

/** Roles que pueden votar una verificación (refleja la máquina de estados). */
function canVoteVerification(role: string): boolean {
  return (
    role === "RESIDENT" ||
    role === "VERIFIED_RESIDENT" ||
    role === "INDEPENDENT_MODERATOR" ||
    role === "PLATFORM_ADMIN"
  );
}

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
      put<VerificationRequest>(db, "verificationRequests", {
        id: newId(),
        reportId: report.id,
        requestedBy: a.id,
        status: "open",
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
  quorum: number;
  resolved: boolean;
}> {
  const a = requireActor(actor);
  if (!canVoteVerification(a.role)) {
    throw new DomainError(
      "FORBIDDEN",
      `El rol ${a.role} no puede votar verificaciones`
    );
  }
  const comment = input.comment?.trim() ?? "";

  const result = await transact((db) => {
    const report = loadReportTx(db, code);
    if (report.state !== "AWAITING_VERIFICATION") {
      throw new DomainError(
        "NOT_IN_VERIFICATION",
        "El reporte no está en verificación"
      );
    }
    const existing = all<VerificationVote>(db, "verificationVotes").filter(
      (v) => v.reportId === report.id
    );
    if (existing.some((v) => v.voterId === a.id)) {
      throw new DomainError("DUPLICATE_VOTE", "Ya votaste en esta verificación");
    }

    const isAuthor = report.authorId === a.id;
    const weight = isAuthor ? 2 : 1;
    const vote: VerificationVote = {
      id: newId(),
      reportId: report.id,
      voterId: a.id,
      voterRole: a.role,
      approve: input.approve,
      comment: comment ? comment : null,
      weight,
      createdAt: nowIso(),
    };
    put(db, "verificationVotes", vote);
    auditTx(db, {
      action: "report.verification_vote",
      actorId: a.id,
      entityType: "report",
      entityId: report.id,
      detail: { code, approve: input.approve, weight },
    });

    let resolved = false;
    if (!input.approve) {
      // Solo el autor o la moderación independiente pueden reabrir con un rechazo.
      if (isAuthor || a.role === "INDEPENDENT_MODERATOR") {
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
      }
      // El rechazo de otros ciudadanos queda registrado como disenso.
    } else {
      const quorum = verificationQuorum();
      const approveWeight = existing
        .filter((v) => v.approve)
        .reduce((sum, v) => sum + v.weight, 0) + weight;
      const moderatorApproves = a.role === "INDEPENDENT_MODERATOR";
      if (moderatorApproves || approveWeight >= quorum) {
        if (moderatorApproves) {
          report.verifierId = a.id;
        }
        applyTransitionTx(db, report, {
          to: "VERIFIED_RESOLVED",
          actorId: a.id,
          actorRole: a.role,
          reason: null,
        });
        for (const vr of all<VerificationRequest>(db, "verificationRequests")) {
          if (vr.reportId === report.id && vr.status === "open") {
            vr.status = "resolved";
          }
        }
        auditTx(db, {
          action: "report.transition",
          actorId: a.id,
          entityType: "report",
          entityId: report.id,
          detail: {
            code,
            to: "VERIFIED_RESOLVED",
            via: "verification_vote",
            approveWeight,
            quorum,
          },
        });
        resolved = true;
      }
    }
    return {
      votes: [...existing, vote],
      resolved,
      reportId: report.id,
    };
  });

  const dto = await read((db) =>
    toReportDto(db, loadReportTx(db, code), a)
  );
  return {
    report: dto,
    votes: result.votes,
    quorum: verificationQuorum(),
    resolved: result.resolved,
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

    items.sort((x, y) => (x.at < y.at ? -1 : 1));
    return items;
  });
}
