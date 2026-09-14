/**
 * FLM — Entidades de dominio (extensión de types.ts).
 * Interfaces para las colecciones del adaptador que no están en types.ts.
 * Contratos estables: la migración a Supabase/PostGIS debe mantenerlos.
 */
import { GeoPoint, ReportState, StateGroup } from "./types";

/** Comuna. */
export interface Municipality {
  id: string;
  name: string;
  /** Prefijo para códigos públicos, ej. "PUD" → FLM-PUD-000123. */
  prefix: string;
  center: GeoPoint;
  createdAt: string;
}

/** Departamento municipal (Aseo y Ornato, Alumbrado Público, ...). */
export interface Department {
  id: string;
  name: string;
  municipalityId: string;
  organizationId: string;
  createdAt: string;
}

/** Agencia externa operativa (eléctrica, sanitaria, ...). */
export interface ExternalAgency {
  id: string;
  organizationId: string;
  name: string;
  createdAt: string;
}

/** Archivo multimedia de un reporte. En el MVP demo se guarda como dataURL;
 *  en producción va a Supabase Storage con URLs firmadas. */
export interface ReportMedia {
  id: string;
  reportId: string;
  dataUrl: string;
  mimeType: string;
  sizeBytes: number;
  kind: "problem" | "solution";
  uploadedBy: string;
  createdAt: string;
}

/** Evidencia de solución (fotos antes/después u otros documentos). */
export interface ResolutionEvidence {
  id: string;
  reportId: string;
  mediaId: string;
  description: string | null;
  uploadedBy: string;
  createdAt: string;
}

/** Respuesta institucional: pública (visible en el timeline) o nota interna. */
export interface InstitutionalResponse {
  id: string;
  reportId: string;
  organizationId: string;
  actorId: string;
  /** "response" = respuesta pública | "note" = nota interna (solo miembros de la org). */
  kind: "response" | "note";
  internal: boolean;
  message: string;
  createdAt: string;
}

/** Posible duplicado detectado (misma categoría, ≤100m, estado no terminal). */
export interface PossibleDuplicate {
  id: string;
  reportId: string;
  candidateReportId: string;
  distanceMeters: number;
  reason: string;
  createdAt: string;
}

/** Decisión humana sobre un posible duplicado. */
export interface DuplicateDecision {
  id: string;
  possibleDuplicateId: string;
  decidedBy: string;
  decision: "confirmed" | "rejected";
  createdAt: string;
}

/** "Yo también vi este problema". Uno por usuario y reporte. */
export interface Confirmation {
  id: string;
  reportId: string;
  userId: string;
  createdAt: string;
}

/** Seguidor de un reporte. Uno por usuario y reporte. */
export interface Follower {
  id: string;
  reportId: string;
  userId: string;
  createdAt: string;
}

/** Asignación a un departamento municipal. */
export interface Assignment {
  id: string;
  reportId: string;
  departmentId: string;
  assignedBy: string;
  createdAt: string;
}

/** Derivación a una agencia externa. */
export interface Referral {
  id: string;
  reportId: string;
  agencyId: string;
  reason: string;
  createdBy: string;
  createdAt: string;
}

/** Voto de verificación ciudadana/independiente. El autor pesa doble. */
export interface VerificationVote {
  id: string;
  reportId: string;
  voterId: string;
  voterRole: string;
  approve: boolean;
  comment: string | null;
  /** 2 si vota el autor, 1 en otro caso. */
  weight: number;
  createdAt: string;
}

/** Solicitud de reapertura (trazabilidad del rechazo del autor). */
export interface ReopenRequest {
  id: string;
  reportId: string;
  requestedBy: string;
  reason: string;
  status: "accepted" | "rejected";
  createdAt: string;
}

/** Solicitud de verificación abierta al pasar a AWAITING_VERIFICATION. */
export interface VerificationRequest {
  id: string;
  reportId: string;
  requestedBy: string | null;
  status: "open" | "resolved" | "reopened";
  createdAt: string;
}

/** DTO público de reporte. `location` exacta solo para actores con alcance. */
export interface ReportDto {
  code: string;
  title: string;
  description: string;
  category: { id: string; name: string; icon: string };
  municipality: { id: string; name: string };
  state: ReportState;
  stateLabel: string;
  stateGroup: StateGroup;
  publicLocation: GeoPoint;
  /** Ubicación exacta: solo si el actor tiene alcance (o es el autor). */
  location?: GeoPoint;
  author: { displayName: string; verifiedResident: boolean };
  confirmationsCount: number;
  followersCount: number;
  confirmedByMe: boolean;
  following: boolean;
  responsibleOrg: { id: string; name: string } | null;
  managingOrg: { id: string; name: string } | null;
  executorOrg: { id: string; name: string } | null;
  /**
   * Sello "Ya estuvo la Muni": true solo si VERIFIED_RESOLVED con gestión
   * municipal acreditada (statusEvents con actor de org municipal).
   * Si se resolvió sin gestión municipal → "Problema resuelto" (false).
   */
  municipalCredit: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
  /** Códigos de posibles duplicados detectados. */
  possibleDuplicates: string[];
}

/** Ítem del timeline público de un reporte. */
export type TimelineItem =
  | {
      type: "status";
      at: string;
      from: ReportState | null;
      to: ReportState;
      toLabel: string;
      reason: string | null;
      actorRole: string | null;
    }
  | {
      type: "response";
      at: string;
      message: string;
      organizationName: string;
    }
  | {
      type: "evidence";
      at: string;
      mediaId: string;
      mimeType: string;
      kind: "problem" | "solution";
      description: string | null;
    }
  | {
      type: "vote";
      at: string;
      approve: boolean;
      weight: number;
      comment: string | null;
      voterDisplay: string;
    };
