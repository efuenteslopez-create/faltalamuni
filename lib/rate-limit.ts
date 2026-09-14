/**
 * FLM — Rate limiting en memoria (token bucket).
 * Suficiente para el MVP demo de un solo proceso. En producción (múltiples
 * instancias) migrar a Redis/Upstash. Ver docs/ARCHITECTURE.md.
 */
interface Bucket {
  tokens: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

export function checkRateLimit(
  key: string,
  opts: { limit: number; windowMs: number } = { limit: 30, windowMs: 60_000 }
): RateLimitResult {
  const now = Date.now();
  let bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    bucket = { tokens: opts.limit, resetAt: now + opts.windowMs };
    buckets.set(key, bucket);
  }
  if (bucket.tokens <= 0) {
    return { allowed: false, remaining: 0, resetAt: bucket.resetAt };
  }
  bucket.tokens -= 1;
  return { allowed: true, remaining: bucket.tokens, resetAt: bucket.resetAt };
}

/** Solo tests. */
export function __resetRateLimits(): void {
  buckets.clear();
}
