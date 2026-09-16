/**
 * FLM — Claves de idempotencia con control de concurrencia (iteración 2).
 *
 * El cliente envía `Idempotency-Key` (UUID) en mutaciones. La identidad de la
 * operación es la tupla (clave, actor, método, ruta normalizada, hash del
 * body): dos envíos concurrentes con la misma identidad ejecutan el efecto
 * UNA sola vez y todos reciben el mismo status/body; si algún componente de
 * la identidad difiere se responde 409 IDEMPOTENCY_CONFLICT sin ejecutar nada.
 *
 * Estados del registro:
 * - PROCESSING: un líder está ejecutando el efecto. Los competidores con la
 *   misma identidad esperan (poll) el resultado en vez de re-ejecutar.
 * - COMPLETED: el efecto terminó (solo se cachean status < 500). Replays
 *   devuelven el status/body original sin re-ejecutar.
 * - FAILED: el efecto lanzó una excepción o devolvió 5xx (los 500 NO se
 *   cachean). Un reintento con la misma identidad puede reclamar la clave y
 *   volver a ejecutar.
 *
 * El reclamo (claim) es atómico vía `transact` (cola de escritura
 * serializada del store): en una instancia/proceso la garantía es fuerte.
 * Un PROCESSING más antiguo que el TTL se considera abandonado (el líder
 * murió sin marcar el registro) y puede ser reclamado.
 *
 * LÍMITE (documentado, no fingido): con el adaptador JSON demo la garantía
 * solo vale dentro de un proceso. En producción multiinstancia (Postgres) el
 * contrato requerido es: INSERT ... ON CONFLICT DO NOTHING sobre una tabla
 * con UNIQUE(idempotency_key), o fila con SELECT ... FOR UPDATE, de modo que
 * el claim siga siendo atómico entre instancias. Ver docs/DECISIONS.md.
 */
import { createHash, randomUUID } from "crypto";
import { transact, read, nowIso } from "@/lib/db/store";
import { DomainError } from "@/lib/domain/types";

export type IdempotencyStatus = "PROCESSING" | "COMPLETED" | "FAILED";

/** Identidad de la operación protegida por la clave. */
export interface IdempotencyFingerprint {
  /** Id del actor autenticado, o null si la ruta lo permite sin sesión. */
  actorId: string | null;
  /** Método HTTP en mayúsculas. */
  method: string;
  /** Pathname normalizado (sin query string ni trailing slash). */
  route: string;
  /** SHA-256 del body canónico (claves ordenadas). */
  bodyHash: string;
}

export interface IdempotencyRecord {
  id: string;
  status: IdempotencyStatus;
  fingerprint: IdempotencyFingerprint;
  /** Token del claim vigente; evita que un líder obsoleto pise un reclamo nuevo. */
  claimId: string;
  statusCode: number | null;
  body: unknown;
  createdAt: string;
  updatedAt: string;
}

export type ClaimOutcome =
  | { outcome: "leader"; claimId: string }
  | { outcome: "wait" }
  | { outcome: "replay"; statusCode: number; body: unknown }
  | { outcome: "conflict" };

/** TTL de un PROCESSING antes de considerarse abandonado (reclamable). */
let processingTtlMs = 5 * 60_000;
/** Cuánto espera un waiter el resultado del líder antes de rendirse. */
const WAIT_TIMEOUT_MS = 30_000;
/** Intervalo de sondeo del waiter. */
const WAIT_POLL_MS = 25;

/** Solo tests: ajusta el TTL de PROCESSING. */
export function __setIdempotencyProcessingTtl(ms: number): void {
  processingTtlMs = ms;
}
/** Solo tests: restaura el TTL por defecto. */
export function __resetIdempotencyProcessingTtl(): void {
  processingTtlMs = 5 * 60_000;
}

/** Serialización canónica: objetos con claves ordenadas, recursivo. */
function canonicalize(value: unknown): unknown {
  if (value === undefined) return null;
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(value).sort()) {
    out[k] = canonicalize((value as Record<string, unknown>)[k]);
  }
  return out;
}

/** Hash estable del body para la huella de identidad. */
export function stableBodyHash(body: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(body)))
    .digest("hex");
}

/** Normaliza la ruta: pathname sin query string ni trailing slash. */
export function normalizeRoute(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    return pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  } catch {
    return url;
  }
}

function sameFingerprint(a: IdempotencyFingerprint, b: IdempotencyFingerprint): boolean {
  return (
    a.actorId === b.actorId &&
    a.method === b.method &&
    a.route === b.route &&
    a.bodyHash === b.bodyHash
  );
}

function processingExpired(rec: IdempotencyRecord): boolean {
  return Date.now() - Date.parse(rec.updatedAt) > processingTtlMs;
}

function asRecord(raw: unknown): IdempotencyRecord | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Partial<IdempotencyRecord>;
  if (typeof r.id !== "string" || typeof r.claimId !== "string") return undefined;
  return r as IdempotencyRecord;
}

/**
 * Reclamo atómico de la clave. Retorna:
 * - leader: este request ejecuta el efecto (con claimId para completarlo).
 * - wait: otro líder con la misma identidad está en curso; esperar.
 * - replay: ya se completó con la misma identidad; devolver lo guardado.
 * - conflict: la clave está ligada a otra identidad; no ejecutar (409).
 */
export async function claimIdempotencyKey(
  key: string,
  fingerprint: IdempotencyFingerprint
): Promise<ClaimOutcome> {
  return transact((db) => {
    const existing = asRecord(db.idempotencyKeys[key]);
    if (!existing) {
      const claimId = randomUUID();
      db.idempotencyKeys[key] = {
        id: key,
        status: "PROCESSING",
        fingerprint,
        claimId,
        statusCode: null,
        body: null,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      } as unknown as (typeof db.idempotencyKeys)[string];
      return { outcome: "leader", claimId } as ClaimOutcome;
    }
    if (!sameFingerprint(existing.fingerprint, fingerprint)) {
      return { outcome: "conflict" } as ClaimOutcome;
    }
    if (existing.status === "COMPLETED") {
      return {
        outcome: "replay",
        statusCode: existing.statusCode ?? 200,
        body: existing.body,
      } as ClaimOutcome;
    }
    if (existing.status === "PROCESSING" && !processingExpired(existing)) {
      return { outcome: "wait" } as ClaimOutcome;
    }
    // FAILED, o PROCESSING abandonado (TTL): reclamar con un claim nuevo.
    const claimId = randomUUID();
    existing.status = "PROCESSING";
    existing.fingerprint = fingerprint;
    existing.claimId = claimId;
    existing.statusCode = null;
    existing.body = null;
    existing.updatedAt = nowIso();
    return { outcome: "leader", claimId } as ClaimOutcome;
  });
}

/** Marca el registro como completado (solo cachea status < 500). */
export async function completeIdempotencyKey(
  key: string,
  claimId: string,
  statusCode: number,
  body: unknown
): Promise<void> {
  await transact((db) => {
    const rec = asRecord(db.idempotencyKeys[key]);
    if (!rec || rec.claimId !== claimId || rec.status !== "PROCESSING") return;
    rec.status = "COMPLETED";
    rec.statusCode = statusCode;
    rec.body = body;
    rec.updatedAt = nowIso();
  });
}

/** Marca el registro como fallido: la clave queda reclamable (no se cachea). */
export async function failIdempotencyKey(
  key: string,
  claimId: string
): Promise<void> {
  await transact((db) => {
    const rec = asRecord(db.idempotencyKeys[key]);
    if (!rec || rec.claimId !== claimId || rec.status !== "PROCESSING") return;
    rec.status = "FAILED";
    rec.statusCode = null;
    rec.body = null;
    rec.updatedAt = nowIso();
  });
}

/**
 * Espera (poll) a que el líder marque el registro COMPLETED/FAILED.
 * Lanza IDEMPOTENCY_UPSTREAM_FAILED si el efecto falló (el cliente debe
 * reintentar con la misma clave) o IDEMPOTENCY_TIMEOUT si el líder no
 * responde a tiempo.
 */
export async function waitForIdempotencyResult(
  key: string
): Promise<{ statusCode: number; body: unknown }> {
  const deadline = Date.now() + WAIT_TIMEOUT_MS;
  for (;;) {
    const rec = await read((db) => asRecord(db.idempotencyKeys[key]));
    if (!rec) {
      throw new DomainError(
        "IDEMPOTENCY_TIMEOUT",
        "Se perdió el registro de idempotencia mientras se esperaba el resultado"
      );
    }
    if (rec.status === "COMPLETED") {
      return { statusCode: rec.statusCode ?? 200, body: rec.body };
    }
    if (rec.status === "FAILED") {
      throw new DomainError(
        "IDEMPOTENCY_UPSTREAM_FAILED",
        "La solicitud original falló; reintente con la misma clave de idempotencia"
      );
    }
    if (Date.now() >= deadline) {
      throw new DomainError(
        "IDEMPOTENCY_TIMEOUT",
        "Tiempo de espera agotado esperando el resultado de la solicitud original"
      );
    }
    await new Promise((r) => setTimeout(r, WAIT_POLL_MS));
  }
}
