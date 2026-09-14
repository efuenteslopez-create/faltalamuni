import { NextRequest } from "next/server";
import {
  findUserByEmail,
  verifyPassword,
  createSession,
  setSessionCookie,
} from "@/lib/auth/auth";
import { buildActor } from "@/lib/auth/actor";
import { loginSchema, formatZodError } from "@/lib/validation/schemas";
import { audit } from "@/lib/audit";
import { handle, ok, fail, rateLimited } from "@/lib/api/http";

export async function POST(req: NextRequest) {
  return handle(async () => {
    const body = await req.json();
    const parsed = loginSchema.safeParse(body);
    if (!parsed.success) {
      return fail("VALIDATION", formatZodError(parsed.error), 400);
    }
    const { email, password } = parsed.data;
    const rl = rateLimited(`login:${email.toLowerCase()}`, 10, 60_000);
    if (rl) return rl;

    const user = await findUserByEmail(email);
    // Mensaje genérico: no revelar si el correo existe.
    const valid =
      user !== undefined && (await verifyPassword(password, user.passwordHash));
    if (!valid || !user) {
      return fail("UNAUTHENTICATED", "Correo o contraseña incorrectos", 401);
    }
    const token = await createSession(user.id);
    setSessionCookie(token);
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
