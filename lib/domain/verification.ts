/**
 * FLM — Verificación ciudadana independiente (iteración 1, hallazgos 1 y 2).
 *
 * FUENTE ÚNICA DE VERDAD para decidir CÓMO se alcanza el quórum de
 * verificación. Quién puede votar lo decide la matriz de capacidades
 * (permissions.ts, capacidad "report.verify": solo RESIDENT y
 * VERIFIED_RESIDENT); la máquina de estados (state-machine.ts) decide quién
 * puede cambiar cada estado (VERIFIED_RESOLVED: solo SYSTEM). Este módulo
 * no duplica esas reglas: solo evalúa el quórum con votos ya validados.
 *
 * PRINCIPIOS (garantía técnica de la independencia):
 * - La transición final a VERIFIED_RESOLVED solo la ejecuta el actor interno
 *   SYSTEM, después de evaluar el quórum dentro de la misma transacción
 *   que registra el voto. Ningún endpoint HTTP puede solicitarla.
 * - Vía A (participa el autor): la aprobación del autor requiere además la
 *   aprobación de al menos un VERIFIED_RESIDENT distinto. El rechazo del
 *   autor, con fundamento obligatorio, reabre el caso.
 * - Vía B (el autor no participa): se requieren al menos tres VERIFIED_RESIDENT
 *   distintos. Los votos de RESIDENT no verificados son opinión visible, no
 *   cuentan para el quórum.
 * - Ninguna cuenta vota más de una vez (se valida al registrar el voto).
 * - Las cuentas vinculadas a la organización gestora o ejecutora no pueden
 *   votar como ciudadanía (se valida al registrar el voto y se excluyen en
 *   la evaluación defensiva).
 */

export interface QuorumVoter {
  voterId: string;
  approve: boolean;
  verifiedResident: boolean;
  /** Cuenta vinculada a la org gestora o ejecutora: excluida del quórum. */
  linkedToManagingOrg: boolean;
}

export type QuorumVia = "author-plus-neighbor" | "community";

export interface QuorumEvaluation {
  resolved: boolean;
  via: QuorumVia | null;
  /** IDs de votantes cuyas aprobaciones activaron la decisión (auditoría). */
  approvingVoterIds: string[];
}

/**
 * Evalúa si las aprobaciones alcanzan el quórum. Función pura: la misma
 * transacción que registra el voto la invoca y, si resuelve, ejecuta la
 * transición a VERIFIED_RESOLVED con actor SYSTEM.
 */
export function evaluateVerificationQuorum(
  authorId: string,
  voters: QuorumVoter[]
): QuorumEvaluation {
  const approvals = voters.filter((v) => v.approve && !v.linkedToManagingOrg);
  const approvingVoterIds = approvals
    .map((v) => v.voterId)
    .filter((id, i, arr) => arr.indexOf(id) === i);
  const authorApproved = approvingVoterIds.includes(authorId);
  const verifiedOthers = approvingVoterIds.filter(
    (id) =>
      id !== authorId &&
      approvals.some((v) => v.voterId === id && v.verifiedResident)
  );

  // Vía A: el autor aprueba + al menos un vecino verificado distinto.
  if (authorApproved && verifiedOthers.length >= 1) {
    return {
      resolved: true,
      via: "author-plus-neighbor",
      approvingVoterIds,
    };
  }
  // Vía B: al menos tres vecinos verificados distintos, sin el autor.
  if (verifiedOthers.length >= 3) {
    return { resolved: true, via: "community", approvingVoterIds };
  }
  return { resolved: false, via: null, approvingVoterIds };
}
