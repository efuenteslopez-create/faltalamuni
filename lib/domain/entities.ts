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

/** Voto de verificación ciudadana/independiente. */
export interface VerificationVote {
  id: string;
  reportId: string;
  /**
   * Ronda (VerificationRequest) a la que pertenece el voto. Los votos NO
   * pertenecen al reporte: pertenecen a una ronda. El quórum se evalúa solo
   * con los votos de la ronda abierta y la unicidad es
   * voterId + verificationRequestId (iteración 1, rondas).
   */
  verificationRequestId: string;
  voterId: string;
  voterRole: string;
  approve: boolean;
  comment: string | null;
  /**
   * Peso histórico: siempre 1 desde la iteración 1. El quórum ya no usa
   * pesos; usa las reglas de verificación (lib/domain/verification.ts).
   * Se conserva el campo por compatibilidad con datos existentes.
   */
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
  /**
   * Ciclo causal de la ronda (iteración 1, hallazgo "causalidad por ciclo"):
   * la propuesta de solución (SOLUTION_PROPOSED) que originó esta ronda y
   * el inicio del ciclo (última REOPENED anterior, si existe). Solo las
   * acciones municipales acreditables con
   * cycleStartAt < createdAt < solutionProposedAt pueden sustentar el sello
   * "Ya estuvo la Muni" para la resolución de ESTA ronda.
   */
  solutionProposedAt: string | null;
  cycleStartAt: string | null;
  createdAt: string;
}

/**
 * Acción municipal acreditable (iteración 1, hallazgo 3).
 *
 * Reemplaza la regla anterior ("cualquier evento de un funcionario acredita
 * gestión"). Solo estas acciones explícitas, registradas por una
 * municipalidad con descripción pública y auditoría, pueden sustentar el
 * sello "Ya estuvo la Muni". Reconocer la recepción, responder públicamente,
 * asignar sin acción posterior o derivar sin seguimiento NO acreditan nada.
 */
export type MunicipalActionType =
  | "EXTERNAL_COORDINATION_RECORDED"
  | "REFERRAL_ACCEPTED_BY_AGENCY"
  | "FIELD_WORK_RECORDED"
  | "CONTRACTOR_ACTION_RECORDED"
  | "SOLUTION_EVIDENCE_SUBMITTED"
  | "FOLLOW_UP_RECORDED";

export const MUNICIPAL_ACTION_TYPES: MunicipalActionType[] = [
  "EXTERNAL_COORDINATION_RECORDED",
  "REFERRAL_ACCEPTED_BY_AGENCY",
  "FIELD_WORK_RECORDED",
  "CONTRACTOR_ACTION_RECORDED",
  "SOLUTION_EVIDENCE_SUBMITTED",
  "FOLLOW_UP_RECORDED",
];

/** Etiquetas públicas en español de Chile. */
export const MUNICIPAL_ACTION_LABELS: Record<MunicipalActionType, string> = {
  EXTERNAL_COORDINATION_RECORDED: "Coordinación externa acreditada",
  REFERRAL_ACCEPTED_BY_AGENCY: "Derivación aceptada por el organismo",
  FIELD_WORK_RECORDED: "Trabajo en terreno registrado",
  CONTRACTOR_ACTION_RECORDED: "Acción de contratista registrada",
  SOLUTION_EVIDENCE_SUBMITTED: "Evidencia de solución presentada",
  FOLLOW_UP_RECORDED: "Seguimiento registrado",
};

export interface MunicipalAction {
  id: string;
  reportId: string;
  /** Organización municipal que registra la acción. */
  organizationId: string;
  /** Funcionario que la registra. */
  actorId: string;
  type: MunicipalActionType;
  /** Descripción pública de lo realizado. */
  publicDescription: string;
  /**
   * Referencia verificable obligatoria: id de un respaldo existente del
   * MISMO reporte (ResolutionEvidence, ReferralAcceptance o PublicReference
   * según el tipo de acción). Un string arbitrario no es respaldo válido.
   */
  evidenceRef: string | null;
  /**
   * Estado de acreditación (iteración 1, hallazgo "respaldo verificable"):
   * true solo si el respaldo fue validado al registrar la acción. Solo las
   * acciones acreditadas pueden sustentar el sello "Ya estuvo la Muni".
   * El endpoint rechaza el respaldo inválido; este campo protege además
   * datos históricos sin respaldo (accredited=false → nunca otorgan crédito).
   */
  accredited: boolean;
  createdAt: string;
}

/**
 * Respaldo público verificable (iteración 1, hallazgo "respaldo
 * verificable"): referencia modelada y validada que sustenta las acciones
 * EXTERNAL_COORDINATION_RECORDED y FOLLOW_UP_RECORDED. No basta la
 * descripción escrita por el funcionario: la referencia debe ser
 * comprobable (documento oficial, registro o URL pública).
 */
export type PublicReferenceKind = "document" | "url" | "registry";

export interface PublicReference {
  id: string;
  reportId: string;
  kind: PublicReferenceKind;
  /** Folio/número de documento, código de registro oficial o URL completa. */
  reference: string;
  /** Qué acredita esta referencia (público). */
  summary: string;
  organizationId: string;
  actorId: string;
  createdAt: string;
}

/**
 * Aceptación o respuesta de una agencia externa a una derivación
 * (iteración 1, hallazgo "respaldo verificable"): mínimo dominio necesario
 * para que REFERRAL_ACCEPTED_BY_AGENCY pueda acreditarse. La registra la
 * agencia receptora, no la municipalidad.
 */
export interface ReferralAcceptance {
  id: string;
  reportId: string;
  referralId: string;
  agencyId: string;
  /** Organización de la agencia que responde. */
  organizationId: string;
  actorId: string;
  accepted: boolean;
  /** Respuesta registrada por la agencia (pública). */
  message: string;
  createdAt: string;
}

/** Respaldo público resuelto para mostrar en el DTO y el timeline. */
export interface MunicipalActionBacking {
  kind: "resolution-evidence" | "referral-acceptance" | "public-reference";
  /** Etiqueta legible, ej. "Evidencia de solución". */
  label: string;
  /** Referencia legible, ej. folio, URL o "evidencia fotográfica". */
  reference: string;
  /** Resumen público del respaldo. */
  summary: string | null;
}

/**
 * Explicación estructurada de la atribución de un reporte (iteración 1,
 * hallazgo 3). El DTO público la incluye siempre: no es solo un booleano.
 *
 * - Responsable: organismo con competencia sobre el problema.
 * - Gestor: institución que recibió, derivó e hizo seguimiento.
 * - Ejecutor: quien realizó el trabajo.
 * - Verificación: ciudadanía (vía autor+vecino o comunidad).
 * - Crédito municipal: "Ya estuvo la Muni" solo con gestión acreditable
 *   causal; si no, "Problema resuelto".
 */
export interface Attribution {
  responsible: { id: string; name: string } | null;
  managing: { id: string; name: string } | null;
  executor: { id: string; name: string } | null;
  verification: {
    mode: "author-plus-neighbor" | "community";
    /** Vecinos cuyas aprobaciones activaron la resolución. */
    approvers: number;
    at: string | null;
  } | null;
  municipalCredit: {
    granted: boolean;
    /** "Ya estuvo la Muni" | "Problema resuelto" */
    headline: string;
    /** Explicación pública del porqué (o porqué no) del reconocimiento. */
    explanation: string;
    actions: Array<{
      type: MunicipalActionType;
      typeLabel: string;
      organizationName: string;
      actorName: string;
      at: string;
      publicDescription: string;
      /** Estado de acreditación (siempre true en acciones causales). */
      accredited: boolean;
      /** Respaldo público verificable de la acción. */
      backing: MunicipalActionBacking | null;
    }>;
  };
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
   * Sello "Ya estuvo la Muni": true solo si VERIFIED_RESOLVED con al menos
   * una acción municipal acreditable causal (ver reportMunicipalCredit en
   * lib/services/common.ts). Si se resolvió sin gestión municipal → false
   * ("Problema resuelto").
   */
  municipalCredit: boolean;
  /**
   * Explicación estructurada de la atribución: responsable, gestor,
   * ejecutor, verificación y detalle del crédito municipal.
   */
  attribution: Attribution;
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
      /**
       * Identificación de ronda (iteración 1, "vincular atribución a la
       * ronda que resolvió"): el voto pertenece a una ronda de
       * verificación, no al reporte. roundNumber es 1-based en orden de
       * creación; currentRound indica la verificación vigente (ronda abierta
       * o última resuelta), para no mezclar visualmente verificaciones
       * anteriores con la actual.
       */
      verificationRequestId: string;
      roundNumber: number;
      currentRound: boolean;
    }
  | {
      type: "municipal-action";
      at: string;
      actionType: MunicipalActionType;
      typeLabel: string;
      organizationName: string;
      actorName: string;
      publicDescription: string;
      accredited: boolean;
      /** Respaldo público verificable; nunca notas internas. */
      backing: MunicipalActionBacking | null;
    };
