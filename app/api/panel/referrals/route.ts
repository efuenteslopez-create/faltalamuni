import { NextRequest } from "next/server";
import { referToAgency } from "@/lib/services/reports";
import { referralSchema, formatZodError } from "@/lib/validation/schemas";
import {
  handle,
  fail,
  requireActor,
  withIdempotency,
  rateLimited,
} from "@/lib/api/http";

/** POST /api/panel/referrals — derivar reporte a una agencia externa. */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const actor = await requireActor();
    const rl = rateLimited(`refer:${actor.id}`, 30, 60_000);
    if (rl) return rl;
    const body = await req.json();
    const { code, ...rest } = body as { code?: unknown };
    if (typeof code !== "string") {
      return fail("VALIDATION", "code: se requiere el código del reporte", 400);
    }
    const parsed = referralSchema.safeParse(rest);
    if (!parsed.success) {
      return fail("VALIDATION", formatZodError(parsed.error), 400);
    }
    return withIdempotency(req, async () => {
      const data = await referToAgency(actor, code, {
        agencyId: parsed.data.agencyId,
        reason: parsed.data.reason,
        expectedVersion: parsed.data.expectedVersion,
      });
      return { status: 200, body: { ok: true, data } };
    });
  });
}
