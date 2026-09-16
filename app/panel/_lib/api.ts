/**
 * FLM Panel institucional — cliente HTTP y tipos contra el contrato API.
 *
 * Nota de alcance: este módulo es propiedad del equipo panel-institucional.
 * Si un endpoint del contrato aún no responde, las páginas muestran un
 * EmptyState amable en lugar de fallar.
 */
import type {
  Category,
  Report,
  ReportState,
  Role,
  StatusEvent,
} from "@/lib/domain/types";
import type { TimelineItem } from "@/lib/domain/entities";

export type { Report, ReportState, Role, Category, StatusEvent, TimelineItem };

/** Error HTTP con estado y cuerpo opcional (sin `any`). */
export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;
  constructor(status: number, message: string, body?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
  get isConflict(): boolean {
    return this.status === 409;
  }
  get isUnauthorized(): boolean {
    return this.status === 401;
  }
  get isForbidden(): boolean {
    return this.status === 403;
  }
}

/** fetch con JSON y credenciales (la sesión viaja en cookie httpOnly). */
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: "include",
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    let body: unknown = undefined;
    try {
      body = await res.json();
    } catch {
      body = undefined;
    }
    const message =
      (body as { error?: string; message?: string } | null)?.error ??
      (body as { error?: string; message?: string } | null)?.message ??
      `Error ${res.status}`;
    throw new ApiError(res.status, message, body);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** Normaliza respuestas que pueden venir como arreglo o como {items|reports|data}. */
export function asArray<T>(payload: unknown): T[] {
  if (Array.isArray(payload)) return payload as T[];
  if (payload !== null && typeof payload === "object") {
    const o = payload as Record<string, unknown>;
    for (const key of ["items", "reports", "data", "events", "notes"]) {
      if (Array.isArray(o[key])) return o[key] as T[];
    }
  }
  return [];
}

/** Usuario de sesión según GET /api/auth/me. */
export interface SessionUser {
  id: string;
  email: string;
  displayName: string;
  role: Role;
  organizationId: string | null;
  municipalityIds: string[];
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object";
}

function normalizeUser(raw: unknown): SessionUser | null {
  const src = isRecord(raw) && isRecord(raw.user) ? raw.user : raw;
  if (!isRecord(src)) return null;
  if (typeof src.id !== "string" || typeof src.role !== "string") return null;
  const memberships = Array.isArray(src.municipalityIds)
    ? (src.municipalityIds.filter((m): m is string => typeof m === "string"))
    : [];
  return {
    id: src.id,
    email: typeof src.email === "string" ? src.email : "",
    displayName:
      typeof src.displayName === "string" ? src.displayName : "Funcionario/a",
    role: src.role as Role,
    organizationId:
      typeof src.organizationId === "string" ? src.organizationId : null,
    municipalityIds: memberships,
  };
}

export async function getMe(): Promise<SessionUser | null> {
  try {
    const data = await api<unknown>("/api/auth/me");
    return normalizeUser(data);
  } catch {
    return null;
  }
}

/** Roles habilitados para el panel operativo de Pudahuel. */
export function isPanelRole(role: Role): boolean {
  return role === "MUNICIPAL_AGENT" || role === "MUNICIPAL_MANAGER";
}

/** Puede exportar CSV (solo gestión). */
export function canExport(role: Role): boolean {
  return role === "MUNICIPAL_MANAGER";
}

/** Cola institucional: GET /api/panel/inbox */
export async function fetchInbox(params: {
  categoryId?: string;
  departmentId?: string;
}): Promise<Report[]> {
  const qs = new URLSearchParams();
  if (params.categoryId) qs.set("categoryId", params.categoryId);
  if (params.departmentId) qs.set("departmentId", params.departmentId);
  const q = qs.toString();
  const payload = await api<unknown>(`/api/panel/inbox${q ? `?${q}` : ""}`);
  return asArray<Report>(payload);
}

export async function fetchCategories(): Promise<Category[]> {
  try {
    return asArray<Category>(await api<unknown>("/api/categories"));
  } catch {
    return [];
  }
}

/** Detalle de reporte para el panel. */
export interface ReportDetail extends Report {
  categoryName?: string;
  departmentName?: string | null;
  assigneeName?: string | null;
  responseCount?: number;
}

export async function fetchReport(code: string): Promise<ReportDetail> {
  const payload = await api<unknown>(
    `/api/reports/${encodeURIComponent(code)}`
  );
  if (isRecord(payload) && isRecord(payload.report)) {
    return payload.report as unknown as ReportDetail;
  }
  return payload as unknown as ReportDetail;
}

/** Evento de la línea de tiempo: el contrato público real (unión discriminada). */

export async function fetchTimeline(code: string): Promise<TimelineItem[]> {
  try {
    const payload = await api<unknown>(
      `/api/reports/${encodeURIComponent(code)}/timeline`
    );
    return asArray<TimelineItem>(payload);
  } catch {
    return [];
  }
}

/** Nota interna: solo visible para miembros de la organización. */
export interface InternalNote {
  id: string;
  authorName: string;
  authorRole: Role;
  body: string;
  createdAt: string;
}

export async function fetchInternalNotes(
  code: string
): Promise<InternalNote[]> {
  const payload = await api<unknown>(
    `/api/reports/${encodeURIComponent(code)}/internal-notes`
  );
  return asArray<InternalNote>(payload);
}

export async function postInternalNote(
  code: string,
  body: string
): Promise<void> {
  await api(`/api/reports/${encodeURIComponent(code)}/internal-notes`, {
    method: "POST",
    body: JSON.stringify({ body }),
  });
}

/** Transición de estado con control de concurrencia optimista. */
export async function postTransition(
  code: string,
  to: ReportState,
  opts: { reason?: string; expectedVersion: number }
): Promise<ReportDetail> {
  const payload = await api<unknown>(
    `/api/reports/${encodeURIComponent(code)}/transitions`,
    {
      method: "POST",
      body: JSON.stringify({
        to,
        reason: opts.reason,
        expectedVersion: opts.expectedVersion,
      }),
    }
  );
  if (isRecord(payload) && isRecord(payload.report)) {
    return payload.report as unknown as ReportDetail;
  }
  return payload as unknown as ReportDetail;
}

export async function postAssignment(
  reportCode: string,
  departmentId: string,
  assignee?: string
): Promise<void> {
  await api("/api/panel/assignments", {
    method: "POST",
    body: JSON.stringify({ reportCode, departmentId, assignee }),
  });
}

export async function postReferral(
  reportCode: string,
  agencyId: string,
  reason: string
): Promise<void> {
  await api("/api/panel/referrals", {
    method: "POST",
    body: JSON.stringify({ reportCode, agencyId, reason }),
  });
}

export async function postPublicResponse(
  code: string,
  message: string
): Promise<void> {
  await api(`/api/reports/${encodeURIComponent(code)}/responses`, {
    method: "POST",
    body: JSON.stringify({ message }),
  });
}

export async function postEvidence(
  code: string,
  dataURL: string
): Promise<void> {
  await api(`/api/reports/${encodeURIComponent(code)}/evidence`, {
    method: "POST",
    body: JSON.stringify({ dataURL }),
  });
}

/** Métricas de la comuna según GET /api/municipalities/mun-pudahuel/metrics. */
export interface MunicipalityMetrics {
  total: number;
  pctResponded: number;
  medianFirstResponseHrs: number;
  pctManaged: number;
  pctSolutionProposed: number;
  pctVerified: number;
  reopened: number;
  referred: number;
  medianSolutionDays: number;
  byCategory: Array<{ slug: string; name: string; verified: number; total?: number }>;
  municipalCreditCount: number;
  methodologyUrl: string;
}

export async function fetchMetrics(): Promise<MunicipalityMetrics> {
  const payload = await api<unknown>(
    "/api/municipalities/mun-pudahuel/metrics"
  );
  const src = isRecord(payload) && isRecord(payload.metrics) ? payload.metrics : payload;
  const r = isRecord(src) ? src : {};
  const num = (v: unknown, d = 0): number =>
    typeof v === "number" && Number.isFinite(v) ? v : d;
  const byCategory = Array.isArray(r.byCategory)
    ? r.byCategory
        .filter(isRecord)
        .map((c) => ({
          slug: typeof c.slug === "string" ? c.slug : "",
          name: typeof c.name === "string" ? c.name : "",
          verified: num(c.verified),
          total: typeof c.total === "number" ? c.total : undefined,
        }))
    : [];
  return {
    total: num(r.total),
    pctResponded: num(r.pctResponded),
    medianFirstResponseHrs: num(r.medianFirstResponseHrs),
    pctManaged: num(r.pctManaged),
    pctSolutionProposed: num(r.pctSolutionProposed),
    pctVerified: num(r.pctVerified),
    reopened: num(r.reopened),
    referred: num(r.referred),
    medianSolutionDays: num(r.medianSolutionDays),
    byCategory,
    municipalCreditCount: num(r.municipalCreditCount),
    methodologyUrl:
      typeof r.methodologyUrl === "string" ? r.methodologyUrl : "/metodologia",
  };
}

/** Departamentos municipales (filtro y asignación). */
export const PANEL_DEPARTMENTS: Array<{ id: string; name: string }> = [
  { id: "aseo-ornato", name: "Aseo y Ornato" },
  { id: "obras", name: "Obras Municipales" },
  { id: "alumbrado", name: "Alumbrado Público" },
  { id: "transito", name: "Tránsito y Transporte Público" },
  { id: "seguridad", name: "Seguridad Ciudadana" },
  { id: "medio-ambiente", name: "Medio Ambiente" },
  { id: "salud", name: "Salud Municipal" },
  { id: "dideco", name: "DIDECO" },
];

/** Agencias externas para derivación. */
export const EXTERNAL_AGENCIES: Array<{ id: string; name: string }> = [
  { id: "serviu", name: "SERVIU Metropolitano" },
  { id: "mop", name: "MOP · Dirección de Vialidad" },
  { id: "electrica", name: "Empresa eléctrica distribuidora" },
  { id: "sanitaria", name: "Empresa sanitaria" },
  { id: "telecom", name: "Empresa de telecomunicaciones" },
];

/** Responsables directos para la clasificación (triaje). */
export const RESPONSIBLE_ORGS: Array<{ id: string; name: string }> = [
  { id: "municipalidad", name: "Municipalidad de Pudahuel (gestión directa)" },
  ...EXTERNAL_AGENCIES,
  { id: "otro", name: "Otro (detallar en el fundamento)" },
];

/** "Hace X" en español de Chile, sin dependencias. */
export function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.max(0, Math.floor(diffMs / 60000));
  if (mins < 1) return "hace un momento";
  if (mins < 60) return `hace ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "hace 1 día";
  if (days < 30) return `hace ${days} días`;
  const months = Math.floor(days / 30);
  if (months === 1) return "hace 1 mes";
  return `hace ${months} meses`;
}

export function ageHours(iso: string): number {
  return (Date.now() - new Date(iso).getTime()) / 3_600_000;
}

/** ¿Vencido? Más de 72 h sin reconocimiento institucional. */
export function isOverdue(r: Report): boolean {
  return (
    (r.state === "REPORTED" ||
      r.state === "AWAITING_RESPONSE" ||
      r.state === "REOPENED") &&
    ageHours(r.createdAt) > 72
  );
}

export function formatDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString("es-CL", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}
