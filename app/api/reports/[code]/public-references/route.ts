import { NextRequest } from "next/server";
import { registerPublicReference } from "@/lib/services/reports";
import {
  publicReferenceSchema,
  formatZodError,
} from "@/lib/validation/schemas";
import {
  handle,
  fail,
  requireActor,
  withIdempotency,
  rateLimited,
} from "@/lib/api/http";
import { PublicReferenceKind } from "@/lib/domain/entities";

/**
 * POST /api/reports/[code]/public-references — registrar una referencia
 * pública verificable (documento oficial, registro o URL pública) que puede
 * respaldar acciones municipales de coordinación y seguimiento.
 *
 * Solo una organización MUNICIPALITY válida y correspondiente al reporte
 * (gestora o municipalidad de la comuna) puede registrarla. Nunca se
 * acepta organizationId, actorId, accredited, createdAt ni roles desde el
 * cliente: todos derivan de la sesión autenticada.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { code: string } }
) {
  return handle(async () => {
    const actor = await requireActor(req);
    const rl = rateLimited(`public-reference:${actor.id}`, 30, 60_000);
    if (rl) return rl;
    const body = await req.json();
    const parsed = publicReferenceSchema.safeParse(body);
    if (!parsed.success) {
      return fail("VALIDATION", formatZodError(parsed.error), 400);
    }
    return withIdempotency(req, async () => {
      const data = await registerPublicReference(actor, params.code, {
        kind: parsed.data.kind as PublicReferenceKind,
        reference: parsed.data.reference,
        summary: parsed.data.summary,
      });
      return { status: 201, body: { ok: true, data } };
    });
  });
}
