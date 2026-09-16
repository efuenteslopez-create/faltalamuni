import { computeMetrics } from "@/lib/indicators";
import { handle, ok } from "@/lib/api/http";

/** GET /api/municipalities/[id]/metrics — indicadores públicos de la comuna. */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return handle(async () => {
    const data = await computeMetrics(id);
    return ok(data);
  });
}
