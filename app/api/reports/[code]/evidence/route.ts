import { NextRequest } from "next/server";
import { addEvidence } from "@/lib/services/reports";
import { validateImageBytes } from "@/lib/services/media";
import { evidenceJsonSchema, formatZodError } from "@/lib/validation/schemas";
import {
  handle,
  fail,
  requireActor,
  withIdempotency,
  rateLimited,
} from "@/lib/api/http";
import { DomainError } from "@/lib/domain/types";

/**
 * POST /api/reports/[code]/evidence — adjuntar evidencia.
 * Acepta JSON { dataUrl, description?, kind? } o multipart/form-data con
 * campo `file` (+ `description`, `kind` opcionales).
 * En el MVP demo se guarda como dataURL en reportMedia; en producción va a
 * Supabase Storage con URLs firmadas.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { code: string } }
) {
  return handle(async () => {
    const actor = await requireActor();
    const rl = rateLimited(`evidence:${actor.id}`, 20, 60_000);
    if (rl) return rl;
    const contentType = req.headers.get("content-type") ?? "";

    let dataUrl: string;
    let description: string | undefined;
    let kind: "problem" | "solution" = "solution";

    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file");
      if (!(file instanceof File)) {
        return fail("VALIDATION", "Se requiere el campo `file`", 400);
      }
      const bytes = Buffer.from(await file.arrayBuffer());
      const validated = validateImageBytes(bytes);
      dataUrl = `data:${validated.mimeType};base64,${bytes.toString("base64")}`;
      const d = form.get("description");
      if (typeof d === "string") description = d;
      const k = form.get("kind");
      if (k === "problem" || k === "solution") kind = k;
    } else {
      const body = await req.json();
      const parsed = evidenceJsonSchema.safeParse(body);
      if (!parsed.success) {
        return fail("VALIDATION", formatZodError(parsed.error), 400);
      }
      dataUrl = parsed.data.dataUrl;
      description = parsed.data.description;
      kind = parsed.data.kind;
    }

    if (description !== undefined && description.trim().length > 500) {
      throw new DomainError("VALIDATION", "Descripción demasiado larga");
    }

    return withIdempotency(req, async () => {
      const data = await addEvidence(actor, params.code, {
        dataUrl,
        description,
        kind,
      });
      return { status: 201, body: { ok: true, data } };
    });
  });
}
