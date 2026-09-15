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
  getIdempotentResponse,
  saveIdempotentResponse,
} from "@/lib/idempotency";
import { checkRateLimit } from "@/lib/rate-limit";

/** Respuesta exitosa estándar: { ok: true, data }. */
export function ok(data: unknown, status = 200): NextResponse {
  return NextResponse.json({ ok: true, data }, { status });
}

/** Respuesta de error estándar: { ok: false, error: { code, message } }. */
export function fail(code: string, message: string, status: number): NextResponse {
  return NextResponse.json({ ok: false, error: { code, message } }, { status });
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

/**
 * Idempotencia a nivel de handler (spec §11): si el header `Idempotency-Key`
 * ya se procesó, retorna la respuesta original sin re-ejecutar la mutación.
 */
export async function withIdempotency(
  req: Request,
  run: () => Promise<{ status: number; body: unknown }>
): Promise<NextResponse> {
  const key = req.headers.get("Idempotency-Key");
  if (key) {
    const cached = await getIdempotentResponse(key);
    if (cached) {
      return NextResponse.json(cached.body, { status: cached.statusCode });
    }
  }
  const { status, body } = await run();
  if (key) {
    await saveIdempotentResponse(key, status, body);
  }
  return NextResponse.json(body, { status });
}

/**
 * Rate limit; retorna una respuesta 429 si se excede, o null si está permitido.
 */
export function rateLimited(
  key: string,
  limit: number,
  windowMs: number
): NextResponse | null {
  const r = checkRateLimit(key, { limit, windowMs });
  if (!r.allowed) {
    return fail(
      "RATE_LIMITED",
      "Demasiadas solicitudes. Intenta nuevamente en unos segundos.",
      429
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
