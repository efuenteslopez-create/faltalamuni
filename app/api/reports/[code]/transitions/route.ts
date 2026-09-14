import { NextRequest } from "next/server";
import { transitionReport } from "@/lib/services/reports";
import {
  reportTransitionSchema,
  formatZodError,
} from "@/lib/validation/schemas";
import {
  handle,
  fail,
  requireActor,
  withIdempotency,
  rateLimited,
} from "@/lib/api/http";
import { ReportState } from "@/lib/domain/types";

/** POST /api/reports/[code]/transitions — cambio de estado institucional/moderación. */
export async function POST(
  req: NextRequest,
  { params }: { params: { code: string } }
) {
  return handle(async () => {
    const actor = await requireActor();
    const rl = rateLimited(`transition:${actor.id}`, 30, 60_000);
    if (rl) return rl;
    const body = await req.json();
    const parsed = reportTransitionSchema.safeParse(body);
    if (!parsed.success) {
      return fail("VALIDATION", formatZodError(parsed.error), 400);
    }
    return withIdempotency(req, async () => {
      const data = await transitionReport(actor, params.code, {
        to: parsed.data.to as ReportState,
        reason: parsed.data.reason,
        expectedVersion: parsed.data.expectedVersion,
      });
      return { status: 200, body: { ok: true, data } };
    });
  });
}
