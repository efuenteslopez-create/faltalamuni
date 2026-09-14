/**
 * FLM — Máquina de estados del reporte (spec §4).
 * Validación 100% en servidor. El cliente jamás decide transiciones.
 *
 * PRINCIPIO DE INDEPENDENCIA: ningún rol institucional (MUNICIPAL_AGENT,
 * MUNICIPAL_MANAGER, EXTERNAL_AGENCY_AGENT) puede ejecutar la transición a
 * VERIFIED_RESOLVED. La verificación final es siempre ciudadana/independiente.
 */
import { DomainError, ReportState, Role } from "./types";

/** Rol pseudo-sistema para transiciones automáticas. */
export type ActorRole = Role | "SYSTEM";

export interface TransitionRule {
  from: ReportState;
  to: ReportState;
  allowed: ActorRole[];
  requiresReason: boolean;
  requiresEvidence?: boolean;
}

/**
 * Tabla de transiciones permitidas. Toda transición no listada es inválida.
 * Decisión documentada: REPORTED pasa automáticamente a AWAITING_RESPONSE
 * al publicarse (misma transacción), representando "esperando respuesta
 * institucional" sin intervención manual.
 */
export const TRANSITIONS: TransitionRule[] = [
  // Publicación
  { from: "REPORTED", to: "AWAITING_RESPONSE", allowed: ["SYSTEM"], requiresReason: false },

  // Recepción y clasificación institucional
  { from: "AWAITING_RESPONSE", to: "ACKNOWLEDGED", allowed: ["MUNICIPAL_AGENT", "MUNICIPAL_MANAGER", "EXTERNAL_AGENCY_AGENT"], requiresReason: false },
  { from: "AWAITING_RESPONSE", to: "TRIAGED", allowed: ["MUNICIPAL_AGENT", "MUNICIPAL_MANAGER", "EXTERNAL_AGENCY_AGENT"], requiresReason: false },
  { from: "ACKNOWLEDGED", to: "TRIAGED", allowed: ["MUNICIPAL_AGENT", "MUNICIPAL_MANAGER", "EXTERNAL_AGENCY_AGENT"], requiresReason: false },

  // Asignación y derivación
  { from: "TRIAGED", to: "ASSIGNED", allowed: ["MUNICIPAL_AGENT", "MUNICIPAL_MANAGER"], requiresReason: false },
  { from: "TRIAGED", to: "REFERRED", allowed: ["MUNICIPAL_AGENT", "MUNICIPAL_MANAGER"], requiresReason: true },

  // Ejecución
  { from: "ASSIGNED", to: "IN_PROGRESS", allowed: ["MUNICIPAL_AGENT", "MUNICIPAL_MANAGER"], requiresReason: false },
  { from: "REFERRED", to: "IN_PROGRESS", allowed: ["MUNICIPAL_AGENT", "MUNICIPAL_MANAGER", "EXTERNAL_AGENCY_AGENT"], requiresReason: false },

  // Solución informada por la institución (techo institucional)
  { from: "IN_PROGRESS", to: "SOLUTION_PROPOSED", allowed: ["MUNICIPAL_AGENT", "MUNICIPAL_MANAGER", "EXTERNAL_AGENCY_AGENT"], requiresReason: false, requiresEvidence: true },
  { from: "SOLUTION_PROPOSED", to: "AWAITING_VERIFICATION", allowed: ["MUNICIPAL_AGENT", "MUNICIPAL_MANAGER", "EXTERNAL_AGENCY_AGENT", "SYSTEM"], requiresReason: false },

  // Verificación independiente — NUNCA un rol institucional
  { from: "AWAITING_VERIFICATION", to: "VERIFIED_RESOLVED", allowed: ["RESIDENT", "VERIFIED_RESIDENT", "INDEPENDENT_MODERATOR", "PLATFORM_ADMIN"], requiresReason: false },
  { from: "AWAITING_VERIFICATION", to: "REOPENED", allowed: ["RESIDENT", "VERIFIED_RESIDENT", "INDEPENDENT_MODERATOR"], requiresReason: true },

  // Reapertura y re-clasificación
  { from: "VERIFIED_RESOLVED", to: "REOPENED", allowed: ["RESIDENT", "VERIFIED_RESIDENT", "INDEPENDENT_MODERATOR"], requiresReason: true },
  { from: "REOPENED", to: "TRIAGED", allowed: ["MUNICIPAL_AGENT", "MUNICIPAL_MANAGER", "INDEPENDENT_MODERATOR"], requiresReason: false },

  // Moderación independiente (con fundamento público obligatorio)
  { from: "REPORTED", to: "REJECTED_WITH_REASON", allowed: ["INDEPENDENT_MODERATOR", "PLATFORM_ADMIN"], requiresReason: true },
  { from: "AWAITING_RESPONSE", to: "REJECTED_WITH_REASON", allowed: ["INDEPENDENT_MODERATOR", "PLATFORM_ADMIN"], requiresReason: true },
  { from: "ACKNOWLEDGED", to: "REJECTED_WITH_REASON", allowed: ["INDEPENDENT_MODERATOR", "PLATFORM_ADMIN"], requiresReason: true },
  { from: "HIDDEN_BY_MODERATION", to: "REPORTED", allowed: ["INDEPENDENT_MODERATOR", "PLATFORM_ADMIN"], requiresReason: true },
];

/** Transiciones de ocultamiento disponibles desde cualquier estado no terminal. */
const HIDABLE_FROM: ReportState[] = [
  "REPORTED",
  "AWAITING_RESPONSE",
  "ACKNOWLEDGED",
  "TRIAGED",
  "ASSIGNED",
  "REFERRED",
  "IN_PROGRESS",
  "SOLUTION_PROPOSED",
  "AWAITING_VERIFICATION",
  "REOPENED",
];

for (const from of HIDABLE_FROM) {
  TRANSITIONS.push({
    from,
    to: "HIDDEN_BY_MODERATION",
    allowed: ["INDEPENDENT_MODERATOR", "PLATFORM_ADMIN"],
    requiresReason: true,
  });
}

export function findRule(from: ReportState, to: ReportState): TransitionRule | undefined {
  return TRANSITIONS.find((t) => t.from === from && t.to === to);
}

export function canTransition(from: ReportState, to: ReportState): boolean {
  return findRule(from, to) !== undefined;
}

export function allowedTransitions(from: ReportState): ReportState[] {
  return TRANSITIONS.filter((t) => t.from === from).map((t) => t.to);
}

/**
 * Valida una transición. Lanza DomainError si es inválida.
 * El chequeo de alcance organizacional (comuna) se hace en la capa de
 * autorización (permissions.ts), no aquí.
 */
export function assertTransition(
  from: ReportState,
  to: ReportState,
  actorRole: ActorRole,
  opts: { reason?: string | null; hasEvidence?: boolean } = {}
): void {
  const rule = findRule(from, to);
  if (!rule) {
    throw new DomainError(
      "INVALID_TRANSITION",
      `Transición no permitida: ${from} → ${to}`
    );
  }
  if (!rule.allowed.includes(actorRole)) {
    throw new DomainError(
      "FORBIDDEN_TRANSITION",
      `El rol ${actorRole} no puede ejecutar ${from} → ${to}`
    );
  }
  if (rule.requiresReason && !opts.reason?.trim()) {
    throw new DomainError("REASON_REQUIRED", `La transición ${from} → ${to} requiere fundamento público`);
  }
  if (rule.requiresEvidence && !opts.hasEvidence) {
    throw new DomainError("EVIDENCE_REQUIRED", `La transición ${from} → ${to} requiere evidencia (foto o documento)`);
  }
}

/** ¿El estado se considera "solucionado verificado"? (para el sello "Ya estuvo la Muni") */
export function isVerifiedResolved(state: ReportState): boolean {
  return state === "VERIFIED_RESOLVED";
}

/** ¿El estado cuenta como pendiente para indicadores? */
export function isPendingState(state: ReportState): boolean {
  return state === "REPORTED" || state === "AWAITING_RESPONSE" || state === "REOPENED";
}
