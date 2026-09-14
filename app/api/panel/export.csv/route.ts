import { NextRequest, NextResponse } from "next/server";
import { exportReportsCsv } from "@/lib/services/panel";
import { exportQuerySchema } from "@/lib/validation/schemas";
import { handle, requireActor, parseQuery, fail } from "@/lib/api/http";

/** GET /api/panel/export.csv — exportación CSV (MUNICIPAL_MANAGER, su comuna). */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const actor = await requireActor();
    const q = parseQuery(exportQuerySchema, req);
    const municipalityId = q.municipalityId ?? actor.municipalityIds[0];
    if (!municipalityId) {
      return fail("VALIDATION", "Sin comuna asociada para exportar", 400);
    }
    const csv = await exportReportsCsv(actor, municipalityId);
    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="flm-reportes-${municipalityId}.csv"`,
      },
    });
  });
}
