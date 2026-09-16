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
  { params }: { params: Promise<{ code: string }> }
) {
  const { code } = await params;
  return handle(async () => {
    const actor = await requireActor(req);
    const rl = rateLimited(`transition:${actor.id}`, 30, 60_000);
    if (rl) return rl;
    const body = await req.json();
    // Barrera HTTP explícita (iteración 1, hallazgo 4): ningún actor
    // autenticado puede solicitar VERIFIED_RESOLVED. Se responde 403 aquí,
    // ANTES de que el esquema Zod rechace el valor con 400: no es un valor
    // "desconocido" sino una intención prohibida. El servicio mantiene su
    // propia barrera (defensa en profundidad) y el actor jamás puede ser
    // SYSTEM: el rol proviene de la sesión, no del JSON.
    if (
      body !== null &&
      typeof body === "object" &&
      (body as { to?: unknown }).to === "VERIFIED_RESOLVED"
    ) {
      return fail(
        "FORBIDDEN",
        "La resolución verificada solo la ejecuta el sistema tras el quórum ciudadano",
        403
      );
    }
    const parsed = reportTransitionSchema.safeParse(body);
    if (!parsed.success) {
      return fail("VALIDATION", formatZodError(parsed.error), 400);
    }
    return withIdempotency(req, async () => {
      const data = await transitionReport(actor, code, {
        to: parsed.data.to as ReportState,
        reason: parsed.data.reason,
        expectedVersion: parsed.data.expectedVersion,
      });
      return { status: 200, body: { ok: true, data } };
    }, { actorId: actor.id, body: parsed.data });
  });
}
