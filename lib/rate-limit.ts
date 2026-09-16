/**
 * FLM — Rate limiting.
 *
 * La interfaz `RateLimiter` es reemplazable: el adaptador en memoria
 * (`InMemoryRateLimiter`) sirve SOLO para demo y tests de un solo proceso.
 * En producción multiinstancia DEBE configurarse un adaptador con
 * almacenamiento compartido (p. ej. Redis/Upstash) vía `setRateLimiter()`;
 * con el adaptador en memoria, cada instancia limita por separado.
 * Ver docs/ARCHITECTURE.md.
 */

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  /** Epoch ms en que se reinicia la ventana. */
  resetAt: number;
}

export interface RateLimitPolicy {
  limit: number;
  windowMs: number;
}

export interface RateLimiter {
  check(key: string, policy: RateLimitPolicy): RateLimitResult;
}

interface Bucket {
  tokens: number;
  resetAt: number;
}

/** Adaptador en memoria (token bucket). Solo demo/test de un proceso. */
export class InMemoryRateLimiter implements RateLimiter {
  private buckets = new Map<string, Bucket>();

  check(key: string, policy: RateLimitPolicy): RateLimitResult {
    const now = Date.now();
    let bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { tokens: policy.limit, resetAt: now + policy.windowMs };
      this.buckets.set(key, bucket);
    }
    if (bucket.tokens <= 0) {
      return { allowed: false, remaining: 0, resetAt: bucket.resetAt };
    }
    bucket.tokens -= 1;
    return { allowed: true, remaining: bucket.tokens, resetAt: bucket.resetAt };
  }

  /** Solo tests. */
  clear(): void {
    this.buckets.clear();
  }
}

let current: RateLimiter = new InMemoryRateLimiter();

/** Adaptador activo. */
export function getRateLimiter(): RateLimiter {
  return current;
}

/**
 * Reemplaza el adaptador (p. ej. por uno con Redis en producción, o un doble
 * de prueba). No se usa en los handlers directamente.
 */
export function setRateLimiter(limiter: RateLimiter): void {
  current = limiter;
}

export function checkRateLimit(
  key: string,
  opts: { limit: number; windowMs: number } = { limit: 30, windowMs: 60_000 }
): RateLimitResult {
  return getRateLimiter().check(key, opts);
}

/** Solo tests: reinicia el adaptador en memoria. */
export function __resetRateLimits(): void {
  current = new InMemoryRateLimiter();
}
