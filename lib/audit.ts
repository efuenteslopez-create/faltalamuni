/**
 * FLM — Auditoría append-only con cadena tamper-evident (spec §2, §11;
 * iteración 2).
 *
 * Toda acción sensible escribe aquí dentro de la misma transacción que la
 * mutación que registra (construcción centralizada en `buildAuditEventTx`).
 * Nada se borra ni se edita.
 *
 * Cadena:
 * - Contenido canónico: JSON con claves ordenadas de
 *   { id, previousHash, action, actorId, entityType, entityId, detail, createdAt }.
 * - `hash` = SHA-256 hex del contenido canónico.
 * - `previousHash` = hash del evento cronológicamente anterior (null en el
 *   génesis). El `createdAt` se fuerza estrictamente creciente dentro de la
 *   transacción (si dos eventos caen en el mismo milisegundo, el segundo se
 *   desplaza +1 ms), de modo que el orden cronológico es total y la cadena
 *   se verifica ordenando por `createdAt`.
 * - `verifyAuditChain` reordena por `createdAt`, exige génesis con
 *   previousHash null, reenlaza cada evento con el anterior y recomputa cada
 *   hash: detecta detail/acción/actor alterados, eventos eliminados y
 *   reordenamientos (cambios de `createdAt`).
 *
 * LÍMITES (documentados, no fingidos): tamper-evident ≠ tamper-proof. La
 * cadena detecta manipulación del JSON, no la impide: un atacante con
 * escritura al archivo puede reescribir la cadena completa (para eso haría
 * falta un log externo inmutable o firmas). Tampoco sustituye restricciones
 * de integridad en Postgres en producción. El `actorId` siempre proviene del
 * servidor (sesión); ningún campo HTTP puede fabricarlo.
 */
import { createHash } from "crypto";
import { transact, read, newId, nowIso, type Database } from "@/lib/db/store";
import { AuditEvent } from "@/lib/domain/types";

export interface AuditInput {
  action: string;
  actorId: string | null;
  entityType: string;
  entityId: string;
  detail?: Record<string, unknown>;
}

/** Serialización canónica: objetos con claves ordenadas, recursivo. */
function canonicalize(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(value as Record<string, unknown>).sort()) {
    out[k] = canonicalize((value as Record<string, unknown>)[k]);
  }
  return out;
}

/** SHA-256 del contenido canónico de un evento (sin el campo `hash`). */
export function hashAuditEvent(event: Omit<AuditEvent, "hash">): string {
  const canonical = canonicalize({
    id: event.id,
    previousHash: event.previousHash,
    action: event.action,
    actorId: event.actorId,
    entityType: event.entityType,
    entityId: event.entityId,
    detail: event.detail,
    createdAt: event.createdAt,
  });
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

function latestEvent(db: Database): AuditEvent | undefined {
  let latest: AuditEvent | undefined;
  for (const raw of Object.values(db.auditEvents)) {
    const e = raw as unknown as AuditEvent;
    if (!latest || e.createdAt > latest.createdAt) latest = e;
  }
  return latest;
}

/**
 * Constructor centralizado del evento (dentro de transacción): enlaza con el
 * evento anterior y firma el contenido. No persiste; el llamador hace `put`.
 */
export function buildAuditEventTx(db: Database, input: AuditInput): AuditEvent {
  const prev = latestEvent(db);
  let createdAt = nowIso();
  if (prev && createdAt <= prev.createdAt) {
    // Orden cronológico total: nunca dos eventos con el mismo createdAt.
    createdAt = new Date(Date.parse(prev.createdAt) + 1).toISOString();
  }
  const event: Omit<AuditEvent, "hash"> = {
    id: newId(),
    action: input.action,
    actorId: input.actorId,
    entityType: input.entityType,
    entityId: input.entityId,
    detail: input.detail ?? {},
    createdAt,
    previousHash: prev?.hash ?? null,
  };
  return { ...event, hash: hashAuditEvent(event) };
}

/**
 * Reencadena todos los eventos del store (uso: seed de datos históricos).
 * Ordena por (createdAt, id) y recomputa previousHash/hash secuencialmente.
 */
export function rechainAuditEventsTx(db: Database): void {
  const events = (Object.values(db.auditEvents) as unknown as AuditEvent[]).sort(
    (a, b) =>
      a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : 1
  );
  let previousHash: string | null = null;
  for (const e of events) {
    const base: Omit<AuditEvent, "hash"> = {
      id: e.id,
      action: e.action,
      actorId: e.actorId,
      entityType: e.entityType,
      entityId: e.entityId,
      detail: e.detail ?? {},
      createdAt: e.createdAt,
      previousHash,
    };
    const hash = hashAuditEvent(base);
    e.previousHash = previousHash;
    e.hash = hash;
    previousHash = hash;
  }
}

/** Auditoría fuera de una transacción de dominio (p. ej. auth/login). */
export async function audit(input: AuditInput): Promise<void> {
  await transact((db) => {
    const event = buildAuditEventTx(db, input);
    db.auditEvents[event.id] = event as unknown as (typeof db.auditEvents)[string];
  });
}

export interface ChainVerification {
  ok: boolean;
  /** Id del primer evento donde se rompe la cadena (si ok=false). */
  atId?: string;
  reason?: string;
}

/**
 * Verifica la cadena: orden cronológico, génesis, reenlace y recomputación
 * de cada hash. Detecta alteraciones de contenido, eliminaciones y
 * reordenamientos.
 */
export function verifyAuditChain(events: AuditEvent[]): ChainVerification {
  const sorted = [...events].sort((a, b) =>
    a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : 1
  );
  let previousHash: string | null = null;
  for (const e of sorted) {
    if (e.previousHash !== previousHash) {
      return {
        ok: false,
        atId: e.id,
        reason:
          previousHash === null
            ? "el primer evento no es génesis (previousHash no nulo)"
            : "previousHash no coincide con el hash del evento anterior (evento eliminado o reordenado)",
      };
    }
    const recomputed = hashAuditEvent(e);
    if (recomputed !== e.hash) {
      return {
        ok: false,
        atId: e.id,
        reason: "el hash no corresponde al contenido (evento alterado)",
      };
    }
    previousHash = e.hash;
  }
  return { ok: true };
}

/** Lee todos los eventos de auditoría del store. */
export async function readAuditEvents(): Promise<AuditEvent[]> {
  return read(
    (db) => Object.values(db.auditEvents) as unknown as AuditEvent[]
  );
}

/** Verifica la cadena completa guardada en el store. */
export async function verifyAuditChainInStore(): Promise<ChainVerification> {
  return verifyAuditChain(await readAuditEvents());
}
