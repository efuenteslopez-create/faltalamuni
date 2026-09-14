import { NextRequest } from "next/server";
import { getInbox } from "@/lib/services/panel";
import { inboxQuerySchema } from "@/lib/validation/schemas";
import { handle, ok, requireActor, parseQuery } from "@/lib/api/http";

/** GET /api/panel/inbox — bandeja institucional (rol institucional + alcance). */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const actor = await requireActor();
    const q = parseQuery(inboxQuerySchema, req);
    const data = await getInbox(actor, { page: q.page, pageSize: q.pageSize });
    return ok(data);
  });
}
