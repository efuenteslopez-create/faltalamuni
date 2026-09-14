import { NextRequest } from "next/server";
import { addPublicResponse } from "@/lib/services/reports";
import {
  publicResponseSchema,
  formatZodError,
} from "@/lib/validation/schemas";
import {
  handle,
  fail,
  requireActor,
  withIdempotency,
  rateLimited,
} from "@/lib/api/http";

/** POST /api/reports/[code]/responses — respuesta pública institucional. */
export async function POST(
  req: NextRequest,
  { params }: { params: { code: string } }
) {
  return handle(async () => {
    const actor = await requireActor();
    const rl = rateLimited(`response:${actor.id}`, 30, 60_000);
    if (rl) return rl;
    const body = await req.json();
    const parsed = publicResponseSchema.safeParse(body);
    if (!parsed.success) {
      return fail("VALIDATION", formatZodError(parsed.error), 400);
    }
    return withIdempotency(req, async () => {
      const data = await addPublicResponse(actor, params.code, {
        message: parsed.data.message,
      });
      return { status: 201, body: { ok: true, data } };
    });
  });
}
