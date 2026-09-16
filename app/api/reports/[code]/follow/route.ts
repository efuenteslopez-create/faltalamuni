import { NextRequest } from "next/server";
import { followReport, unfollowReport } from "@/lib/services/reports";
import {
  handle,
  requireActor,
  withIdempotency,
  rateLimited,
} from "@/lib/api/http";

/** POST /api/reports/[code]/follow — seguir un reporte. */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code } = await params;
  return handle(async () => {
    const actor = await requireActor(req);
    const rl = rateLimited(`follow:${actor.id}`, 30, 60_000);
    if (rl) return rl;
    return withIdempotency(req, async () => {
      const data = await followReport(actor, code);
      return { status: 200, body: { ok: true, data } };
    }, { actorId: actor.id });
  });
}

/** DELETE /api/reports/[code]/follow — dejar de seguir. */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code } = await params;
  return handle(async () => {
    const actor = await requireActor(req);
    const rl = rateLimited(`follow:${actor.id}`, 30, 60_000);
    if (rl) return rl;
    return withIdempotency(req, async () => {
      const data = await unfollowReport(actor, code);
      return { status: 200, body: { ok: true, data } };
    }, { actorId: actor.id });
  });
}
