import { cookies } from "next/headers";
import {
  SESSION_COOKIE,
  destroySession,
  clearSessionCookie,
} from "@/lib/auth/auth";
import { handle, ok } from "@/lib/api/http";

export async function POST() {
  return handle(async () => {
    const token = (await cookies()).get(SESSION_COOKIE)?.value;
    if (token) {
      await destroySession(token);
    }
    await clearSessionCookie();
    return ok({ loggedOut: true });
  });
}
