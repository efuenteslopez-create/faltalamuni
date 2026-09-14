/**
 * Soporte compartido de tests: base de datos temporal aislada por test.
 * Cada test llama a `freshDb()` (típicamente en beforeEach) para apuntar
 * FLM_DATA_DIR a un directorio temporal y reiniciar la caché del store.
 */
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { newId, nowIso, transact, __resetCache } from "@/lib/db/store";
import { Actor } from "@/lib/domain/permissions";
import { Role, User } from "@/lib/domain/types";

/** Aísla la base de datos: nuevo directorio temporal + caché reiniciada. */
export function freshDb(): string {
  const dir = mkdtempSync(join(tmpdir(), "flm-test-"));
  process.env.FLM_DATA_DIR = dir;
  __resetCache();
  return dir;
}

export async function makeUser(input: {
  email: string;
  displayName: string;
  role: Role;
  verifiedResident?: boolean;
}): Promise<User> {
  const user: User = {
    id: newId(),
    email: input.email,
    passwordHash: "test-hash",
    role: input.role,
    displayName: input.displayName,
    verifiedResident: input.verifiedResident ?? false,
    createdAt: nowIso(),
  };
  await transact((db) => {
    db.users[user.id] = user as unknown as (typeof db.users)[string];
  });
  return user;
}

export function makeActor(
  user: User,
  opts: { organizationId?: string; municipalityIds?: string[] } = {}
): Actor {
  return {
    id: user.id,
    role: user.role,
    organizationId: opts.organizationId ?? null,
    municipalityIds: opts.municipalityIds ?? [],
    verifiedResident: user.verifiedResident,
  };
}

/** Espera que la promesa falle con un error cuyo `code` sea el indicado. */
export async function expectCode(
  promise: Promise<unknown>,
  code: string
): Promise<void> {
  try {
    await promise;
  } catch (e) {
    const actual = (e as { code?: unknown }).code;
    if (actual !== code) {
      throw new Error(
        `Se esperaba code=${code} pero fue code=${String(actual)}: ${(e as Error).message}`
      );
    }
    return;
  }
  throw new Error(`Se esperaba que fallara con code=${code}, pero no falló`);
}

/** PNG 1x1 válido para pruebas de evidencia. */
export const PNG_1PX =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
