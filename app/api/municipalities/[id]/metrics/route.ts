import { computeMetrics } from "@/lib/indicators";
import { handle, ok } from "@/lib/api/http";

/** GET /api/municipalities/[id]/metrics — indicadores públicos de la comuna. */
export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  return handle(async () => {
    const data = await computeMetrics(params.id);
    return ok(data);
  });
}
