import { NextRequest } from "next/server";
import {
  createUser,
  findUserByEmail,
  createSession,
  setSessionCookie,
} from "@/lib/auth/auth";
import { buildActor } from "@/lib/auth/actor";
import { registerSchema, formatZodError } from "@/lib/validation/schemas";
import { audit } from "@/lib/audit";
import { handle, ok, fail, rateLimited } from "@/lib/api/http";

/** Registro de vecinos. Siempre rol RESIDENT (sin escalamiento por API). */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const rl = rateLimited(`register:${req.ip ?? "unknown"}`, 10, 60_000);
    if (rl) return rl;
    const body = await req.json();
    const parsed = registerSchema.safeParse(body);
    if (!parsed.success) {
      return fail("VALIDATION", formatZodError(parsed.error), 400);
    }
    const { email, password, displayName } = parsed.data;
    const existing = await findUserByEmail(email);
    if (existing) {
      return fail("VALIDATION", "Ese correo ya está registrado", 400);
    }
    const user = await createUser({
      email,
      password,
      displayName,
      role: "RESIDENT",
    });
    await audit({
      action: "auth.register",
      actorId: user.id,
      entityType: "user",
      entityId: user.id,
      detail: { email: user.email },
    });
    const token = await createSession(user.id);
    setSessionCookie(token);
    const actor = await buildActor(user);
    return ok(
      {
        user: {
          id: user.id,
          email: user.email,
          displayName: user.displayName,
          role: user.role,
          verifiedResident: user.verifiedResident,
        },
        actor,
      },
      201
    );
  });
}
