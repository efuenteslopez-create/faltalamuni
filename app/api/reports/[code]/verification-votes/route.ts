import { NextRequest } from "next/server";
import { voteVerification } from "@/lib/services/reports";
import {
  verificationVoteSchema,
  formatZodError,
} from "@/lib/validation/schemas";
import {
  handle,
  fail,
  requireActor,
  withIdempotency,
  rateLimited,
} from "@/lib/api/http";

/** POST /api/reports/[code]/verification-votes — votar la verificación. */
export async function POST(
  req: NextRequest,
  { params }: { params: { code: string } }
) {
  return handle(async () => {
    const actor = await requireActor();
    const rl = rateLimited(`vote:${actor.id}`, 30, 60_000);
    if (rl) return rl;
    const body = await req.json();
    const parsed = verificationVoteSchema.safeParse(body);
    if (!parsed.success) {
      return fail("VALIDATION", formatZodError(parsed.error), 400);
    }
    return withIdempotency(req, async () => {
      const data = await voteVerification(actor, params.code, {
        approve: parsed.data.approve,
        comment: parsed.data.comment,
      });
      return { status: 200, body: { ok: true, data } };
    });
  });
}
