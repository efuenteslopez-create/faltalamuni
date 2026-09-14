/**
 * FLM — Tipos de dominio compartidos.
 * Fuente única de verdad para estados, roles y entidades.
 * La migración a Supabase/PostGIS debe mantener estos contratos (ver docs/ARCHITECTURE.md).
 */

/** Los 13 estados de la máquina de estados del reporte (spec §4). */
export type ReportState =
  | "REPORTED"
  | "AWAITING_RESPONSE"
  | "ACKNOWLEDGED"
  | "TRIAGED"
  | "ASSIGNED"
  | "REFERRED"
  | "IN_PROGRESS"
  | "SOLUTION_PROPOSED"
  | "AWAITING_VERIFICATION"
  | "VERIFIED_RESOLVED"
  | "REOPENED"
  | "REJECTED_WITH_REASON"
  | "HIDDEN_BY_MODERATION";

export const REPORT_STATES: ReportState[] = [
  "REPORTED",
  "AWAITING_RESPONSE",
  "ACKNOWLEDGED",
  "TRIAGED",
  "ASSIGNED",
  "REFERRED",
  "IN_PROGRESS",
  "SOLUTION_PROPOSED",
  "AWAITING_VERIFICATION",
  "VERIFIED_RESOLVED",
  "REOPENED",
  "REJECTED_WITH_REASON",
  "HIDDEN_BY_MODERATION",
];

/** Etiquetas públicas en español de Chile. */
export const REPORT_STATE_LABELS: Record<ReportState, string> = {
  REPORTED: "Reportado",
  AWAITING_RESPONSE: "Esperando respuesta",
  ACKNOWLEDGED: "Recibido",
  TRIAGED: "Clasificado",
  ASSIGNED: "Asignado",
  REFERRED: "Derivado",
  IN_PROGRESS: "En gestión",
  SOLUTION_PROPOSED: "Solución informada",
  AWAITING_VERIFICATION: "En verificación",
  VERIFIED_RESOLVED: "Solucionado verificado",
  REOPENED: "Reabierto",
  REJECTED_WITH_REASON: "Rechazado con fundamento",
  HIDDEN_BY_MODERATION: "Restringido por moderación",
};

/** Grupo visual del estado: pendiente / en curso / verificado / neutro. */
export type StateGroup = "pending" | "progress" | "verified" | "neutral";
export const REPORT_STATE_GROUPS: Record<ReportState, StateGroup> = {
  REPORTED: "pending",
  AWAITING_RESPONSE: "pending",
  ACKNOWLEDGED: "progress",
  TRIAGED: "progress",
  ASSIGNED: "progress",
  REFERRED: "progress",
  IN_PROGRESS: "progress",
  SOLUTION_PROPOSED: "progress",
  AWAITING_VERIFICATION: "progress",
  VERIFIED_RESOLVED: "verified",
  REOPENED: "pending",
  REJECTED_WITH_REASON: "neutral",
  HIDDEN_BY_MODERATION: "neutral",
};

/** Roles de la plataforma (spec §13). */
export type Role =
  | "RESIDENT"
  | "VERIFIED_RESIDENT"
  | "MUNICIPAL_AGENT"
  | "MUNICIPAL_MANAGER"
  | "EXTERNAL_AGENCY_AGENT"
  | "INDEPENDENT_MODERATOR"
  | "PLATFORM_ADMIN";

export const ROLES: Role[] = [
  "RESIDENT",
  "VERIFIED_RESIDENT",
  "MUNICIPAL_AGENT",
  "MUNICIPAL_MANAGER",
  "EXTERNAL_AGENCY_AGENT",
  "INDEPENDENT_MODERATOR",
  "PLATFORM_ADMIN",
];

/** Punto geográfico. En PostGIS: geography(Point, 4326). */
export interface GeoPoint {
  lng: number;
  lat: number;
}

/** Categorías de problema urbano. */
export interface Category {
  id: string;
  slug: string;
  name: string;
  icon: string; // nombre de icono (no emoji en UI crítica; se mapea a SVG)
  sensitiveLocation: boolean; // si true, se aproximan coordenadas públicas
}

/** Reporte ciudadano. `state` está materializado; la historia real vive en status_events. */
export interface Report {
  id: string; // UUID interno
  code: string; // código público legible, ej. FLM-PUD-000123
  municipalityId: string;
  categoryId: string;
  title: string;
  description: string; // texto original, inmutable por instituciones
  location: GeoPoint; // ubicación exacta (acceso restringido)
  publicLocation: GeoPoint; // ubicación pública (aproximada si categoría sensible)
  state: ReportState;
  version: number; // control de concurrencia optimista
  authorId: string;
  anonymousPublic: boolean;
  responsibleOrgId: string | null; // responsable directo identificado
  managingOrgId: string | null; // gestor
  executorOrgId: string | null; // ejecutor
  verifierId: string | null; // verificador independiente
  confirmationsCount: number;
  followersCount: number;
  createdAt: string;
  updatedAt: string;
}

/** Evento de cambio de estado (fuente histórica real). */
export interface StatusEvent {
  id: string;
  reportId: string;
  from: ReportState | null;
  to: ReportState;
  actorId: string | null; // null = sistema
  reason: string | null;
  idempotencyKey: string | null;
  createdAt: string;
}

/** Usuario. */
export interface User {
  id: string;
  email: string;
  passwordHash: string; // scrypt
  role: Role;
  displayName: string;
  verifiedResident: boolean;
  createdAt: string;
}

/** Organización (municipalidad licenciada, empresa externa, etc.). */
export interface Organization {
  id: string;
  kind: "MUNICIPALITY" | "EXTERNAL_AGENCY" | "PLATFORM";
  name: string;
  shortName: string;
  verified: boolean;
  municipalityId: string | null; // comuna a la que pertenece/gestiona
  createdAt: string;
}

export interface Membership {
  id: string;
  userId: string;
  organizationId: string;
  role: Role;
  createdAt: string;
}

/** Evento de auditoría append-only. */
export interface AuditEvent {
  id: string;
  action: string;
  actorId: string | null;
  entityType: string;
  entityId: string;
  detail: Record<string, unknown>;
  createdAt: string;
}

export class DomainError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "DomainError";
  }
}
