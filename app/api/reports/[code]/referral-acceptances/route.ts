import { NextRequest } from "next/server";
import { recordReferralAcceptance } from "@/lib/services/reports";
import {
  referralAcceptanceSchema,
  formatZodError,
} from "@/lib/validation/schemas";
import {
  handle,
  fail,
  requireActor,
  withIdempotency,
  rateLimited,
} from "@/lib/api/http";

/**
 * POST /api/reports/[code]/referral-acceptances — la agencia receptora de
 * una derivación registra su aceptación o respuesta. Es el respaldo que
 * permite acreditar REFERRAL_ACCEPTED_BY_AGENCY.
 *
 * Solo la agencia receptora de ESA derivación puede responderla: una
 * municipalidad no puede fabricar la aceptación de una agencia, y una
 * agencia distinta tampoco puede responder. Nunca se acepta
 * organizationId, actorId, createdAt ni roles desde el cliente: todos
 * derivan de la sesión autenticada.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { code: string } }
) {
  return handle(async () => {
    const actor = await requireActor(req);
    const rl = rateLimited(`referral-acceptance:${actor.id}`, 30, 60_000);
    if (rl) return rl;
    const body = await req.json();
    const parsed = referralAcceptanceSchema.safeParse(body);
    if (!parsed.success) {
      return fail("VALIDATION", formatZodError(parsed.error), 400);
    }
    return withIdempotency(req, async () => {
      const data = await recordReferralAcceptance(actor, params.code, {
        referralId: parsed.data.referralId,
        accepted: parsed.data.accepted,
        message: parsed.data.message,
      });
      return { status: 201, body: { ok: true, data } };
    });
  });
}
