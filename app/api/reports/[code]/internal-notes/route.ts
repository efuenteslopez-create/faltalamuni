import { NextRequest } from "next/server";
import { addInternalNote, listInternalNotes } from "@/lib/services/reports";
import { internalNoteSchema, formatZodError } from "@/lib/validation/schemas";
import {
  handle,
  ok,
  fail,
  requireActor,
  withIdempotency,
  rateLimited,
} from "@/lib/api/http";

/** GET /api/reports/[code]/internal-notes — solo miembros de la organización. */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code } = await params;
  return handle(async () => {
    const actor = await requireActor(req);
    const data = await listInternalNotes(actor, code);
    return ok(data);
  });
}

/** POST /api/reports/[code]/internal-notes — nota interna de la organización. */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code } = await params;
  return handle(async () => {
    const actor = await requireActor(req);
    const rl = rateLimited(`note:${actor.id}`, 30, 60_000);
    if (rl) return rl;
    const body = await req.json();
    const parsed = internalNoteSchema.safeParse(body);
    if (!parsed.success) {
      return fail("VALIDATION", formatZodError(parsed.error), 400);
    }
    return withIdempotency(req, async () => {
      const data = await addInternalNote(actor, code, {
        message: parsed.data.message,
      });
      return { status: 201, body: { ok: true, data } };
    }, { actorId: actor.id, body: parsed.data });
  });
}
