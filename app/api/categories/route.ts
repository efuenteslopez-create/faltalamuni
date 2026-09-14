import { read } from "@/lib/db/store";
import { Category } from "@/lib/domain/types";
import { handle, ok } from "@/lib/api/http";

/** GET /api/categories — catálogo público de categorías. */
export async function GET() {
  return handle(async () => {
    const data = await read((db) =>
      (Object.values(db.categories) as unknown as Category[]).map((c) => ({
        id: c.id,
        slug: c.slug,
        name: c.name,
        icon: c.icon,
      }))
    );
    return ok(data);
  });
}
