/**
 * FLM — Cliente HTTP tipado para la API pública (equipo dominio-datos).
 * Programa contra el contrato documentado; si un endpoint aún no existe,
 * las llamadas fallan con ApiError y la UI muestra estados amables.
 */
import type { GeoPoint, ReportState, Role } from "@/lib/domain/types";

/* ------------------------------------------------------------------ */
/* Tipos del contrato                                                  */
/* ------------------------------------------------------------------ */

export interface ApiUser {
  id: string;
  email: string;
  displayName: string;
  role: Role;
}

export interface ApiCategory {
  id: string;
  slug: string;
  name: string;
  icon: string;
}

export interface ReportListItem {
  code: string;
  title: string;
  categoryId: string;
  state: ReportState;
  publicLocation: GeoPoint;
  confirmationsCount: number;
  createdAt: string;
  municipalCredit: boolean;
}

export interface ReportsListResponse {
  items: ReportListItem[];
  page: number;
  total: number;
}

export interface ReportDetail extends ReportListItem {
  description: string;
  anonymousPublic: boolean;
  authorDisplayName: string | null;
  followersCount: number;
  photoUrl: string | null;
  evidenceUrls: string[];
  timelineUrl: string;
  createdAt: string;
  updatedAt: string;
}

export interface TimelineEvent {
  from: ReportState | null;
  to: ReportState;
  actorRole: string | null;
  reason: string | null;
  createdAt: string;
}

export interface TimelineResponse {
  events: TimelineEvent[];
  responses: unknown[];
  votes: unknown[];
}

export interface DuplicateCandidate {
  code: string;
  title: string;
  distanceM: number;
  state: ReportState;
}

export interface CreateReportBody {
  categoryId: string;
  title: string;
  description: string;
  location: GeoPoint;
  anonymousPublic: boolean;
  photoDataUrl?: string;
  idempotencyKey?: string;
}

/* ------------------------------------------------------------------ */
/* Cliente                                                             */
/* ------------------------------------------------------------------ */

export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      ...init,
    });
  } catch {
    // Sin red o el servidor no responde: la UI lo trata como offline.
    throw new ApiError(0, "Sin conexión con el servidor");
  }
  if (res.status === 204) return undefined as T;
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok) {
    const msg =
      typeof body === "object" && body !== null && "error" in body
        ? String((body as { error: unknown }).error)
        : `Error ${res.status}`;
    const code =
      typeof body === "object" && body !== null && "code" in body
        ? String((body as { code: unknown }).code)
        : undefined;
    throw new ApiError(res.status, msg, code);
  }
  // El contrato envuelve en { ok, data } en algunos endpoints.
  if (
    typeof body === "object" &&
    body !== null &&
    "ok" in body &&
    "data" in body
  ) {
    return (body as { data: T }).data;
  }
  return body as T;
}

export const api = {
  /* Auth */
  me(): Promise<{ user: ApiUser }> {
    return request("/api/auth/me");
  },
  login(body: { email: string; password: string }): Promise<{ user: ApiUser }> {
    return request("/api/auth/login", {
      method: "POST",
      body: JSON.stringify(body),
    });
  },
  register(body: {
    email: string;
    password: string;
    displayName: string;
  }): Promise<{ user: ApiUser }> {
    return request("/api/auth/register", {
      method: "POST",
      body: JSON.stringify(body),
    });
  },
  logout(): Promise<void> {
    return request("/api/auth/logout", { method: "POST" });
  },

  /* Categorías */
  categories(): Promise<ApiCategory[]> {
    return request("/api/categories");
  },

  /* Reportes */
  reports(params?: {
    state?: string;
    categoryId?: string;
    near?: string;
    page?: number;
  }): Promise<ReportsListResponse> {
    const q = new URLSearchParams();
    if (params?.state) q.set("state", params.state);
    if (params?.categoryId) q.set("categoryId", params.categoryId);
    if (params?.near) q.set("near", params.near);
    if (params?.page) q.set("page", String(params.page));
    const qs = q.toString();
    return request(`/api/reports${qs ? `?${qs}` : ""}`);
  },
  report(code: string): Promise<ReportDetail> {
    return request(`/api/reports/${encodeURIComponent(code)}`);
  },
  createReport(body: CreateReportBody): Promise<{ code: string }> {
    return request("/api/reports", { method: "POST", body: JSON.stringify(body) });
  },
  timeline(code: string): Promise<TimelineResponse> {
    return request(`/api/reports/${encodeURIComponent(code)}/timeline`);
  },
  confirm(code: string): Promise<void> {
    return request(`/api/reports/${encodeURIComponent(code)}/confirm`, {
      method: "POST",
    });
  },
  follow(code: string): Promise<void> {
    return request(`/api/reports/${encodeURIComponent(code)}/follow`, {
      method: "POST",
    });
  },
  unfollow(code: string): Promise<void> {
    return request(`/api/reports/${encodeURIComponent(code)}/follow`, {
      method: "DELETE",
    });
  },
  verificationVote(
    code: string,
    body: { approve: boolean; comment?: string }
  ): Promise<void> {
    return request(`/api/reports/${encodeURIComponent(code)}/verification-votes`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  },
  duplicates(params: {
    lng: number;
    lat: number;
    categoryId: string;
  }): Promise<{ items: DuplicateCandidate[] }> {
    const q = new URLSearchParams({
      lng: String(params.lng),
      lat: String(params.lat),
      categoryId: params.categoryId,
    });
    return request(`/api/duplicates?${q.toString()}`);
  },
};

/** Mensaje amable para mostrar al usuario a partir de un error de API. */
export function friendlyErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 0)
      return "No pudimos conectarnos. Revisa tu conexión e inténtalo de nuevo.";
    if (err.status === 401)
      return "Necesitas iniciar sesión para hacer eso.";
    if (err.status === 404) return "No encontramos lo que buscabas.";
    if (err.status === 409)
      return "Esa acción ya fue registrada. Actualiza la página.";
    if (err.status >= 500)
      return "Tuvimos un problema en nuestros servidores. Inténtalo en unos minutos.";
    return err.message || "Algo salió mal. Inténtalo de nuevo.";
  }
  return "Algo salió mal. Inténtalo de nuevo.";
}
