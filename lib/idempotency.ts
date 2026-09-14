/**
 * FLM — Claves de idempotencia para mutaciones críticas (spec §11).
 * El cliente envía `Idempotency-Key` (UUID). Si la clave ya se procesó, se
 * retorna la respuesta original sin re-ejecutar la mutación.
 */
import { transact, read, nowIso } from "@/lib/db/store";

interface IdempotencyRecord {
  id: string; // la clave
  statusCode: number;
  body: unknown;
  createdAt: string;
}

export async function getIdempotentResponse(
  key: string
): Promise<{ statusCode: number; body: unknown } | null> {
  const rec = await read(
    (db) => db.idempotencyKeys[key] as unknown as IdempotencyRecord | undefined
  );
  if (!rec) return null;
  return { statusCode: rec.statusCode, body: rec.body };
}

export async function saveIdempotentResponse(
  key: string,
  statusCode: number,
  body: unknown
): Promise<void> {
  await transact((db) => {
    if (!db.idempotencyKeys[key]) {
      db.idempotencyKeys[key] = {
        id: key,
        statusCode,
        body,
        createdAt: nowIso(),
      };
    }
  });
}
