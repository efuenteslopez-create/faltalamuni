/**
 * FLM — Utilidades compartidas de los Route Handlers.
 * Los handlers son wrappers delgados: parsean cookies→actor, validan Zod,
 * chequean rate limit + idempotencia, llaman al servicio y mapean errores.
 */
import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, getAuth, getAuthFromToken } from "@/lib/auth/auth";
import { buildActor } from "@/lib/auth/actor";
import { Actor } from "@/lib/domain/permissions";
import { DomainError } from "@/lib/domain/types";
import {
  claimIdempotencyKey,
  completeIdempotencyKey,
  failIdempotencyKey,
  waitForIdempotencyResult,
  normalizeRoute,
  stableBodyHash,
  type IdempotencyFingerprint,
} from "@/lib/idempotency";
import { checkRateLimit } from "@/lib/rate-limit";

/** Respuesta exitosa estándar: { ok: true, data }. */
export function ok(data: unknown, status = 200): NextResponse {
  return NextResponse.json({ ok: true, data }, { status });
}

/** Respuesta de error estándar: { ok: false, error: { code, message } }. */
export function fail(
  code: string,
  message: string,
  status: number,
  headers?: Record<string, string>
): NextResponse {
  return NextResponse.json(
    { ok: false, error: { code, message } },
    { status, headers }
  );
}

const STATUS_BY_CODE: Record<string, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  FORBIDDEN_TRANSITION: 403,
  SCOPE_FORBIDDEN: 403,
  NOT_FOUND: 404,
  REPORT_NOT_FOUND: 404,
  CATEGORY_NOT_FOUND: 404,
  MUNICIPALITY_NOT_FOUND: 404,
  DEPARTMENT_NOT_FOUND: 404,
  AGENCY_NOT_FOUND: 404,
  REFERRAL_NOT_FOUND: 404,
  USER_NOT_FOUND: 404,
  NOT_FOLLOWING: 404,
  VALIDATION: 400,
  BACKING_REQUIRED: 400,
  BACKING_NOT_FOUND: 400,
  BACKING_MISMATCH: 400,
  INVALID_BACKING: 400,
  NO_OPEN_VERIFICATION_ROUND: 400,
  INVALID_TRANSITION: 400,
  REASON_REQUIRED: 400,
  EVIDENCE_REQUIRED: 400,
  INVALID_STATE: 400,
  INVALID_IMAGE: 400,
  IMAGE_TOO_LARGE: 400,
  NOT_IN_VERIFICATION: 400,
  VERSION_CONFLICT: 409,
  VERIFICATION_ROUND_OPEN: 409,
  DUPLICATE_VOTE: 409,
  ALREADY_CONFIRMED: 409,
  ALREADY_FOLLOWING: 409,
  ALREADY_ANSWERED: 409,
  IDEMPOTENCY_CONFLICT: 409,
  IDEMPOTENCY_UPSTREAM_FAILED: 502,
  IDEMPOTENCY_TIMEOUT: 503,
  RATE_LIMITED: 429,
};

/** Mapea cualquier error lanzado por servicios a una respuesta HTTP. */
export function mapError(err: unknown): NextResponse {
  if (err instanceof DomainError) {
    const status = STATUS_BY_CODE[err.code] ?? 500;
    if (status >= 500) console.error("[flm] domain error 500:", err);
    return fail(err.code, err.message, status);
  }
  const code = (err as { code?: unknown } | null)?.code;
  if (typeof code === "string") {
    const status = STATUS_BY_CODE[code] ?? 500;
    const message =
      err instanceof Error ? err.message : "Error interno del servidor";
    if (status >= 500) console.error("[flm] error 500:", err);
    return fail(code, message, status);
  }
  console.error("[flm] unexpected error:", err);
  return fail("INTERNAL", "Error interno del servidor", 500);
}

/**
 * Envuelve un handler para mapear errores automáticamente.
 * Uso: `export const POST = (req) => handle(async () => { ... })`.
 */
export function handle(fn: () => Promise<NextResponse>): Promise<NextResponse> {
  return fn().catch(mapError);
}

/**
 * Actor desde la cookie de sesión, o null si no hay sesión válida.
 * Si se entrega `req`, la cookie se lee del Request explícito (los tests de
 * integración invocan los handlers reales con un NextRequest); si no, se
 * usa `next/headers` como antes. El rol siempre proviene de la sesión en
 * base de datos: JSON, cookies, headers o parámetros jamás pueden fabricar
 * un actor (y mucho menos SYSTEM).
 */
export async function getActor(req?: NextRequest): Promise<Actor | null> {
  const auth = req
    ? await getAuthFromToken(req.cookies.get(SESSION_COOKIE)?.value ?? null)
    : await getAuth();
  if (!auth) return null;
  return buildActor(auth.user);
}

/** Actor requerido; lanza UNAUTHENTICATED si no hay sesión. */
export async function requireActor(req?: NextRequest): Promise<Actor> {
  const actor = await getActor(req);
  if (!actor) {
    throw new DomainError("UNAUTHENTICATED", "Se requiere iniciar sesión");
  }
  return actor;
}

/** Opciones de identidad para `withIdempotency`. */
export interface IdempotencyOptions {
  /** Id del actor autenticado que ejecuta la mutación. */
  actorId?: string | null;
  /**
   * Cuerpo ya parseado/validado para el hash estable de identidad.
   * Alternativa: `bodyHash` precomputado (p. ej. evidencia multipart).
   */
  body?: unknown;
  /** Hash precomputado; si se entrega, se usa en vez de `body`. */
  bodyHash?: string;
}

/**
 * Idempotencia a nivel de handler (spec §11, iteración 2 con concurrencia):
 * la identidad es (clave, actor, método, ruta normalizada, hash del body).
 *
 * - Misma identidad concurrente: un solo efecto; los demás esperan y reciben
 *   el mismo status/body.
 * - Misma identidad ya completada: replay sin re-ejecutar (no se cachean 500).
 * - Distinta identidad con la misma clave: 409 IDEMPOTENCY_CONFLICT.
 */
export async function withIdempotency(
  req: Request,
  run: () => Promise<{ status: number; body: unknown }>,
  opts: IdempotencyOptions = {}
): Promise<NextResponse> {
  const key = req.headers.get("Idempotency-Key")?.trim();
  if (!key) {
    const { status, body } = await run();
    return NextResponse.json(body, { status });
  }
  const fingerprint: IdempotencyFingerprint = {
    actorId: opts.actorId ?? null,
    method: (req.method ?? "POST").toUpperCase(),
    route: normalizeRoute(req.url),
    bodyHash: opts.bodyHash ?? stableBodyHash(opts.body ?? null),
  };
  const claim = await claimIdempotencyKey(key, fingerprint);
  if (claim.outcome === "replay") {
    return NextResponse.json(claim.body, { status: claim.statusCode });
  }
  if (claim.outcome === "conflict") {
    return fail(
      "IDEMPOTENCY_CONFLICT",
      "La clave de idempotencia ya fue usada con otra solicitud (distinto actor, ruta, método o cuerpo)",
      409
    );
  }
  if (claim.outcome === "wait") {
    const result = await waitForIdempotencyResult(key);
    return NextResponse.json(result.body, { status: result.statusCode });
  }
  // Líder: ejecuta el efecto una sola vez.
  try {
    const { status, body } = await run();
    if (status >= 500) {
      // Los 500 no se cachean: el reintento con la misma clave reclama y
      // re-ejecuta.
      await failIdempotencyKey(key, claim.claimId);
    } else {
      await completeIdempotencyKey(key, claim.claimId, status, body);
    }
    return NextResponse.json(body, { status });
  } catch (err) {
    await failIdempotencyKey(key, claim.claimId);
    throw err;
  }
}

/**
 * Rate limit; retorna una respuesta 429 con cabecera Retry-After si se
 * excede, o null si está permitido.
 */
export function rateLimited(
  key: string,
  limit: number,
  windowMs: number
): NextResponse | null {
  const r = checkRateLimit(key, { limit, windowMs });
  if (!r.allowed) {
    const retryAfter = Math.max(1, Math.ceil((r.resetAt - Date.now()) / 1000));
    return fail(
      "RATE_LIMITED",
      "Demasiadas solicitudes. Intenta nuevamente en unos segundos.",
      429,
      { "Retry-After": String(retryAfter) }
    );
  }
  return null;
}

/** Parsea query params con un esquema Zod; lanza VALIDATION si falla. */
export function parseQuery<T>(
  schema: { safeParse: (v: unknown) => { success: true; data: T } | { success: false; error: { message: string } } },
  req: Request
): T {
  const params = Object.fromEntries(new URL(req.url).searchParams.entries());
  const parsed = schema.safeParse(params);
  if (!parsed.success) {
    throw new DomainError("VALIDATION", parsed.error.message);
  }
  return parsed.data;
}
