import { read } from "@/lib/db/store";
import { Municipality } from "@/lib/domain/entities";
import { handle, ok } from "@/lib/api/http";

/** GET /api/municipalities — catálogo público de comunas. */
export async function GET() {
  return handle(async () => {
    const data = await read((db) =>
      (Object.values(db.municipalities) as unknown as Municipality[])
        .map((m) => ({
          id: m.id,
          name: m.name,
          prefix: m.prefix,
          center: m.center,
        }))
        .sort((a, b) => a.name.localeCompare(b.name))
    );
    return ok(data);
  });
}
