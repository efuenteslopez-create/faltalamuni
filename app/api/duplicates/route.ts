import { NextRequest } from "next/server";
import { findDuplicateCandidates } from "@/lib/services/reports";
import { duplicatesQuerySchema } from "@/lib/validation/schemas";
import { handle, ok, parseQuery } from "@/lib/api/http";

/** GET /api/duplicates?lng=&lat=&categoryId= — candidatos a duplicado. */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const q = parseQuery(duplicatesQuerySchema, req);
    const data = await findDuplicateCandidates({
      lng: q.lng,
      lat: q.lat,
      categoryId: q.categoryId,
      radiusM: q.radiusM,
    });
    return ok(data);
  });
}
