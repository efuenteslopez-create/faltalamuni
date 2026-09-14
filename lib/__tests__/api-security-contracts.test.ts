/**
 * FLM — Tests de seguridad de contratos API (PENDIENTE DE INTEGRACIÓN).
 *
 * Equipo seguridad-qa-docs. Estos tests se activarán cuando el equipo
 * dominio-datos publique los handlers bajo `app/api/**`. Están escritos como
 * `describe.skip` con el plan exacto de aserciones para no bloquear el MVP.
 *
 * Contratos que deberán cumplir los handlers (ver docs/PERMISSIONS.md y
 * docs/PRIVACY_AND_SECURITY.md):
 */
import { describe, it } from "vitest";

describe.skip("API: contratos de seguridad (pendiente: handlers de dominio-datos)", () => {
  it("POST /api/auth/login aplica rate limit por IP y no enumera usuarios", () => {
    // - Más de N intentos → 429 con Retry-After.
    // - Email inexistente vs password incorrecta → mismo mensaje y tiempo
    //   similar (sin enumeración de cuentas).
  });

  it("POST /api/auth/login y /api/auth/register setean cookie httpOnly/SameSite", () => {
    // - Set-Cookie incluye HttpOnly, SameSite=Lax, Path=/, Secure en prod.
    // - El body de respuesta NUNCA incluye el token de sesión.
  });

  it("todas las mutaciones validan con Zod y retornan 400 con mensaje útil", () => {
    // - POST /api/reports con body inválido → 400 (no 500).
    // - Campos extra se ignoran (no mass assignment de role, state, etc.).
  });

  it("rutas protegidas retornan 401 sin sesión y 403 sin capacidad", () => {
    // - Sin cookie → 401 { code: "UNAUTHENTICATED" }.
    // - Con sesión pero sin capacidad (permissions.ts) → 403 { code: "FORBIDDEN" }.
  });

  it("transiciones de estado validan rol, razón y evidencia en servidor", () => {
    // - Intento de transición no listada → 422 INVALID_TRANSITION.
    // - Rol institucional intentando VERIFIED_RESOLVED → 403 (techo institucional).
    // - expectedVersion desactualizado → 409 (concurrencia optimista).
  });

  it("mutaciones críticas respetan Idempotency-Key", () => {
    // - Reintento con la misma clave → misma respuesta, sin duplicar efectos.
  });

  it("subida de fotos valida magic bytes y tamaño en servidor", () => {
    // - dataURL con magic bytes falsos → 400.
    // - Sobre 5MB → 413.
  });

  it("GET /api/health no expone información sensible", () => {
    // - Sin versiones internas, paths, ni variables de entorno.
  });
});
