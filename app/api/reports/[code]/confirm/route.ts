import { NextRequest } from "next/server";
import { confirmReport } from "@/lib/services/reports";
import { confirmationSchema } from "@/lib/validation/schemas";
import {
  handle,
  requireActor,
  withIdempotency,
  rateLimited,
} from "@/lib/api/http";

/** POST /api/reports/[code]/confirm — "Yo también vi este problema". */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code } = await params;
  return handle(async () => {
    const actor = await requireActor(req);
    const rl = rateLimited(`confirm:${actor.id}`, 30, 60_000);
    if (rl) return rl;
    let body: unknown = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }
    confirmationSchema.parse(body);
    return withIdempotency(req, async () => {
      const data = await confirmReport(actor, code);
      return { status: 200, body: { ok: true, data } };
    }, { actorId: actor.id, body });
  });
}
