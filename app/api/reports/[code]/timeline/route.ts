import { getTimeline } from "@/lib/services/reports";
import { handle, ok, getActor } from "@/lib/api/http";

/** GET /api/reports/[code]/timeline — historia pública del reporte. */
export async function GET(
  _req: Request,
  { params }: { params: { code: string } }
) {
  return handle(async () => {
    const actor = await getActor();
    const data = await getTimeline(params.code, actor);
    return ok(data);
  });
}
