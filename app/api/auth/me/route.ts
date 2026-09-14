import { getAuth } from "@/lib/auth/auth";
import { buildActor } from "@/lib/auth/actor";
import { handle, ok } from "@/lib/api/http";

export async function GET() {
  return handle(async () => {
    const auth = await getAuth();
    if (!auth) {
      return ok({ user: null, actor: null });
    }
    const actor = await buildActor(auth.user);
    return ok({
      user: {
        id: auth.user.id,
        email: auth.user.email,
        displayName: auth.user.displayName,
        role: auth.user.role,
        verifiedResident: auth.user.verifiedResident,
      },
      actor,
    });
  });
}
