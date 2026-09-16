import { getReportByCode } from "@/lib/services/reports";
import { handle, ok, getActor } from "@/lib/api/http";

/** GET /api/reports/[code] — detalle de un reporte. */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code } = await params;
  return handle(async () => {
    const actor = await getActor();
    const data = await getReportByCode(code, actor);
    return ok(data);
  });
}
