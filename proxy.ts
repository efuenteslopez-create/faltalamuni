/**
 * FLM — Proxy de protección de rutas (Next 16; antes `middleware.ts`).
 *
 * Protege `/panel/**` y `/perfil/**`: si no hay cookie de sesión, redirige a
 * `/login?next=<ruta original>`.
 *
 * Solo verifica PRESENCIA de la cookie, no su validez ni el rol: la validez
 * de la sesión la verifica `getAuth()`/`requireAuth()` en cada página y API,
 * y el rol lo valida cada página/API con `lib/domain/permissions.ts`.
 * Esto es intencional: el proxy no consulta el adaptador de sesiones.
 *
 * NOTA: `SESSION_COOKIE` se duplica aquí a propósito (no se importa desde
 * `lib/auth/auth.ts` porque ese módulo usa `node:crypto` y `next/headers`.
 * Si cambia el nombre de la cookie, cambiar aquí.
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/** Debe coincidir con SESSION_COOKIE en lib/auth/auth.ts. */
const SESSION_COOKIE = "flm_session";

export function proxy(request: NextRequest): NextResponse {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    // `next` preserva la ruta completa a la que se quería entrar.
    // El handler de /login debe sanitizarlo con safeRedirect (lib/security.ts).
    loginUrl.search = `?next=${encodeURIComponent(
      request.nextUrl.pathname + request.nextUrl.search
    )}`;
    return NextResponse.redirect(loginUrl);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/panel/:path*", "/perfil/:path*"],
};
