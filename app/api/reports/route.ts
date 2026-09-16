import { NextRequest } from "next/server";
import {
  createReport,
  listReports,
  ListReportsFilters,
} from "@/lib/services/reports";
import {
  reportCreateSchema,
  reportListQuerySchema,
  formatZodError,
} from "@/lib/validation/schemas";
import {
  handle,
  ok,
  fail,
  getActor,
  requireActor,
  rateLimited,
  withIdempotency,
  parseQuery,
} from "@/lib/api/http";
import { ReportState } from "@/lib/domain/types";

/** GET /api/reports — listado público con filtros y paginación. */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const q = parseQuery(reportListQuerySchema, req);
    const actor = await getActor();
    const filters: ListReportsFilters = {
      state: q.state as ReportState | undefined,
      categoryId: q.categoryId,
      municipalityId: q.municipalityId,
      page: q.page,
      pageSize: q.pageSize,
    };
    if (
      q.lng !== undefined &&
      q.lat !== undefined &&
      q.radiusM !== undefined
    ) {
      filters.near = { lng: q.lng, lat: q.lat, radiusM: q.radiusM };
    }
    const data = await listReports(filters, actor);
    return ok(data);
  });
}

/** POST /api/reports — crear reporte (10/min por usuario, Idempotency-Key). */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const actor = await requireActor(req);
    const rl = rateLimited(`report-create:${actor.id}`, 10, 60_000);
    if (rl) return rl;
    const body = await req.json();
    const parsed = reportCreateSchema.safeParse(body);
    if (!parsed.success) {
      return fail("VALIDATION", formatZodError(parsed.error), 400);
    }
    return withIdempotency(req, async () => {
      const data = await createReport(actor, {
        categoryId: parsed.data.categoryId,
        municipalityId: parsed.data.municipalityId,
        title: parsed.data.title,
        description: parsed.data.description,
        location: parsed.data.location,
        anonymousPublic: parsed.data.anonymousPublic,
        photoDataUrl: parsed.data.photoDataUrl,
      });
      return { status: 201, body: { ok: true, data } };
    }, { actorId: actor.id, body: parsed.data });
  });
}
