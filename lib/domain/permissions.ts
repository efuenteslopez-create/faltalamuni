/**
 * FLM — Permisos por capacidades (spec §13).
 * Sin condicionales improvisados: toda autorización sensible pasa por aquí
 * en el servidor, además de las políticas de acceso del adaptador.
 */
import { Role } from "./types";

/** Capacidades atómicas del sistema. */
export type Capability =
  | "report.create"
  | "report.confirm" // "Yo también vi este problema"
  | "report.follow"
  | "report.verify" // votar una solución: SOLO ciudadanía (RESIDENT, VERIFIED_RESIDENT).
  // Ni INDEPENDENT_MODERATOR ni PLATFORM_ADMIN votan: su poder es moderar
  // contenido con fundamento, jamás aprobar soluciones (iteración 1).
  | "report.reopen"
  | "institutional.acknowledge"
  | "institutional.triage"
  | "institutional.assign"
  | "institutional.refer"
  | "institutional.progress"
  | "institutional.propose_solution"
  | "institutional.request_verification"
  | "institutional.internal_notes" // leer/escribir notas internas (separadas)
  | "institutional.respond_public"
  | "institutional.respond_referral" // la agencia receptora responde/acepta una derivación
  | "institutional.export"
  | "institutional.manage_members"
  | "moderation.hide"
  | "moderation.reject"
  | "moderation.restore"
  | "platform.admin";

/** Matriz rol → capacidades. PROBADA en tests (ver lib/domain/__tests__). */
export const PERMISSION_MATRIX: Record<Role, Capability[]> = {
  RESIDENT: [
    "report.create",
    "report.confirm",
    "report.follow",
    "report.verify",
    "report.reopen",
  ],
  VERIFIED_RESIDENT: [
    "report.create",
    "report.confirm",
    "report.follow",
    "report.verify",
    "report.reopen",
  ],
  MUNICIPAL_AGENT: [
    "institutional.acknowledge",
    "institutional.triage",
    "institutional.assign",
    "institutional.refer",
    "institutional.progress",
    "institutional.propose_solution",
    "institutional.request_verification",
    "institutional.internal_notes",
    "institutional.respond_public",
  ],
  MUNICIPAL_MANAGER: [
    "institutional.acknowledge",
    "institutional.triage",
    "institutional.assign",
    "institutional.refer",
    "institutional.progress",
    "institutional.propose_solution",
    "institutional.request_verification",
    "institutional.internal_notes",
    "institutional.respond_public",
    "institutional.export",
    "institutional.manage_members",
  ],
  EXTERNAL_AGENCY_AGENT: [
    "institutional.acknowledge",
    "institutional.triage",
    "institutional.progress",
    "institutional.propose_solution",
    "institutional.respond_public",
    "institutional.respond_referral",
  ],
  INDEPENDENT_MODERATOR: [
    "report.create",
    "report.confirm",
    "report.follow",
    "moderation.hide",
    "moderation.reject",
    "moderation.restore",
  ],
  PLATFORM_ADMIN: [
    "report.create",
    "report.confirm",
    "report.follow",
    "report.reopen",
    "institutional.export",
    "moderation.hide",
    "moderation.reject",
    "moderation.restore",
    "platform.admin",
  ],
};

export function hasCapability(role: Role, capability: Capability): boolean {
  return PERMISSION_MATRIX[role]?.includes(capability) ?? false;
}

export function assertCapability(role: Role, capability: Capability): void {
  if (!hasCapability(role, capability)) {
    const err = new Error(`El rol ${role} no tiene la capacidad ${capability}`);
    (err as Error & { code: string }).code = "FORBIDDEN";
    throw err;
  }
}

export interface Actor {
  id: string;
  role: Role;
  /** Organización a la que pertenece (para roles institucionales). */
  organizationId: string | null;
  /** Comuna(s) sobre las que tiene alcance. */
  municipalityIds: string[];
  verifiedResident: boolean;
}

/**
 * Alcance organizacional: un funcionario solo gestiona reportes de su comuna,
 * salvo autorización explícita. PLATFORM_ADMIN e INDEPENDENT_MODERATOR tienen
 * alcance global solo para sus capacidades (moderación/auditoría), jamás para
 * editar reportes ciudadanos.
 */
export function inScope(actor: Actor, municipalityId: string): boolean {
  if (actor.role === "PLATFORM_ADMIN" || actor.role === "INDEPENDENT_MODERATOR") {
    return true;
  }
  return actor.municipalityIds.includes(municipalityId);
}

/** ¿Es un rol institucional (municipalidad o agencia externa)? */
export function isInstitutionalRole(role: Role): boolean {
  return (
    role === "MUNICIPAL_AGENT" ||
    role === "MUNICIPAL_MANAGER" ||
    role === "EXTERNAL_AGENCY_AGENT"
  );
}

/**
 * Regla de independencia (spec §2): la edición del contenido original del
 * reporte (texto, fotos, fecha, ubicación) está prohibida para TODOS los
 * roles institucionales y también para PLATFORM_ADMIN en forma silenciosa
 * (cualquier corrección excepcional la hace moderación con caso auditable).
 */
export function canEditOriginalReport(role: Role): boolean {
  return false;
  void role;
}

/** ¿Puede ver notas internas de una organización? Solo miembros de esa org. */
export function canReadInternalNotes(actor: Actor, organizationId: string): boolean {
  if (!hasCapability(actor.role, "institutional.internal_notes")) return false;
  if (actor.role === "PLATFORM_ADMIN") return false; // ni siquiera el admin ve notas internas ajenas
  return actor.organizationId === organizationId;
}
