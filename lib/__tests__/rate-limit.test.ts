/**
 * FLM — Tests de seguridad: lib/rate-limit (equipo seguridad-qa-docs).
 *
 * Cubre: permitir hasta el límite, bloquear al excederlo, conteo de
 * `remaining`, reinicio al expirar la ventana e independencia entre claves.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { checkRateLimit, __resetRateLimits } from "@/lib/rate-limit";

beforeEach(() => {
  __resetRateLimits();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("checkRateLimit", () => {
  it("permite hasta el límite y luego bloquea", () => {
    const opts = { limit: 3, windowMs: 60_000 };
    expect(checkRateLimit("login:1.2.3.4", opts).allowed).toBe(true);
    expect(checkRateLimit("login:1.2.3.4", opts).allowed).toBe(true);
    const last = checkRateLimit("login:1.2.3.4", opts);
    expect(last.allowed).toBe(true);
    expect(last.remaining).toBe(0);

    const blocked = checkRateLimit("login:1.2.3.4", opts);
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
  });

  it("descuenta remaining en cada uso permitido", () => {
    const opts = { limit: 5, windowMs: 60_000 };
    expect(checkRateLimit("k", opts).remaining).toBe(4);
    expect(checkRateLimit("k", opts).remaining).toBe(3);
  });

  it("reinicia los tokens al expirar la ventana", () => {
    const opts = { limit: 2, windowMs: 60_000 };
    checkRateLimit("k", opts);
    checkRateLimit("k", opts);
    expect(checkRateLimit("k", opts).allowed).toBe(false);

    vi.advanceTimersByTime(60_001);
    const fresh = checkRateLimit("k", opts);
    expect(fresh.allowed).toBe(true);
    expect(fresh.remaining).toBe(1);
  });

  it("las claves son independientes entre sí", () => {
    const opts = { limit: 1, windowMs: 60_000 };
    expect(checkRateLimit("ip-a", opts).allowed).toBe(true);
    expect(checkRateLimit("ip-a", opts).allowed).toBe(false);
    expect(checkRateLimit("ip-b", opts).allowed).toBe(true);
  });

  it("usa valores por defecto razonables (30/min)", () => {
    for (let i = 0; i < 30; i++) {
      expect(checkRateLimit("default").allowed).toBe(true);
    }
    expect(checkRateLimit("default").allowed).toBe(false);
  });

  it("informa resetAt en el futuro", () => {
    const res = checkRateLimit("k", { limit: 10, windowMs: 60_000 });
    expect(res.resetAt).toBeGreaterThan(Date.now());
  });
});
