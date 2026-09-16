import { NextRequest } from "next/server";
import {
  findUserByEmail,
  verifyLoginPassword,
  createSession,
  setSessionCookie,
  normalizeEmail,
} from "@/lib/auth/auth";
import { buildActor } from "@/lib/auth/actor";
import { loginSchema, formatZodError } from "@/lib/validation/schemas";
import { audit } from "@/lib/audit";
import { handle, ok, fail, rateLimited } from "@/lib/api/http";
import { getClientIp } from "@/lib/security/ip";

/**
 * Límites combinados de login (ventana de 60 s):
 * - por IP: frena la rotación de emails desde una misma IP;
 * - por email normalizado: frena el ataque a una cuenta desde varias IP;
 * - por combinación IP+email: frena la fuerza bruta dirigida.
 * La IP se extrae según la política explícita de `lib/security/ip.ts`.
 */
const LOGIN_WINDOW_MS = 60_000;
const LOGIN_IP_LIMIT = 30;
const LOGIN_EMAIL_LIMIT = 10;
const LOGIN_IP_EMAIL_LIMIT = 10;

export async function POST(req: NextRequest) {
  return handle(async () => {
    const body = await req.json();
    const parsed = loginSchema.safeParse(body);
    if (!parsed.success) {
      return fail("VALIDATION", formatZodError(parsed.error), 400);
    }
    const email = normalizeEmail(parsed.data.email);
    const ip = getClientIp(req) ?? "unknown";
    for (const [bucket, limit] of [
      [`login:ip:${ip}`, LOGIN_IP_LIMIT],
      [`login:email:${email}`, LOGIN_EMAIL_LIMIT],
      [`login:ip-email:${ip}:${email}`, LOGIN_IP_EMAIL_LIMIT],
    ] as const) {
      const rl = rateLimited(bucket, limit, LOGIN_WINDOW_MS);
      if (rl) return rl;
    }

    const user = await findUserByEmail(email);
    // Camino criptográfico idéntico exista o no el usuario: si no existe, se
    // verifica contra un hash dummy (mismo scrypt, resultado siempre falso).
    // Mensaje y estructura idénticos en ambos casos: sin enumeración.
    const passwordOk = await verifyLoginPassword(
      parsed.data.password,
      user?.passwordHash
    );
    if (!user || !passwordOk) {
      return fail("UNAUTHENTICATED", "Correo o contraseña incorrectos", 401);
    }
    const token = await createSession(user.id);
    await setSessionCookie(token);
    await audit({
      action: "auth.login",
      actorId: user.id,
      entityType: "user",
      entityId: user.id,
      detail: {},
    });
    const actor = await buildActor(user);
    return ok({
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        role: user.role,
        verifiedResident: user.verifiedResident,
      },
      actor,
    });
  });
}
