import { NextRequest } from "next/server";
import { recordMunicipalAction } from "@/lib/services/reports";
import {
  municipalActionSchema,
  formatZodError,
} from "@/lib/validation/schemas";
import {
  handle,
  fail,
  requireActor,
  withIdempotency,
  rateLimited,
} from "@/lib/api/http";
import { MunicipalActionType } from "@/lib/domain/entities";

/**
 * POST /api/reports/[code]/municipal-actions — registrar una acción
 * municipal acreditable (iteración 1, hallazgo 3).
 * Solo organizaciones MUNICIPALITY; es el único mecanismo que sustenta
 * el sello "Ya estuvo la Muni".
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code } = await params;
  return handle(async () => {
    const actor = await requireActor(req);
    const rl = rateLimited(`municipal-action:${actor.id}`, 30, 60_000);
    if (rl) return rl;
    const body = await req.json();
    const parsed = municipalActionSchema.safeParse(body);
    if (!parsed.success) {
      return fail("VALIDATION", formatZodError(parsed.error), 400);
    }
    return withIdempotency(req, async () => {
      const data = await recordMunicipalAction(actor, code, {
        type: parsed.data.type as MunicipalActionType,
        publicDescription: parsed.data.publicDescription,
        evidenceRef: parsed.data.evidenceRef,
      });
      return { status: 201, body: { ok: true, data } };
    }, { actorId: actor.id, body: parsed.data });
  });
}
