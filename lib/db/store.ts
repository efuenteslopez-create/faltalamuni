/**
 * FLM — Adaptador de persistencia demo (spec §10/§11).
 *
 * Patrón adaptador limpio: el resto del código solo habla con `db` (colecciones
 * tipadas + transacciones lógicas). La implementación actual persiste en un
 * archivo JSON con escrituras atómicas (tmp + rename) y serialización de
 * escrituras. En producción se reemplaza por el adaptador Supabase/PostGIS
 * manteniendo esta interfaz. Ver docs/ARCHITECTURE.md ("Ruta de migración").
 *
 * NUNCA se finge que esto es Supabase: es almacenamiento local de demo.
 */
import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";

export type CollectionName =
  | "users"
  | "organizations"
  | "memberships"
  | "municipalities"
  | "departments"
  | "externalAgencies"
  | "categories"
  | "reports"
  | "reportRevisions"
  | "reportMedia"
  | "confirmations"
  | "followers"
  | "possibleDuplicates"
  | "duplicateDecisions"
  | "assignments"
  | "referrals"
  | "statusEvents"
  | "institutionalResponses"
  | "resolutionEvidence"
  | "verificationRequests"
  | "verificationVotes"
  | "reopenRequests"
  | "moderationCases"
  | "auditEvents"
  | "notifications"
  | "idempotencyKeys"
  | "sessions"
  | "sequences";

type Doc = Record<string, unknown> & { id: string };
type Database = Record<CollectionName, Record<string, Doc>>;

const COLLECTIONS: CollectionName[] = [
  "users",
  "organizations",
  "memberships",
  "municipalities",
  "departments",
  "externalAgencies",
  "categories",
  "reports",
  "reportRevisions",
  "reportMedia",
  "confirmations",
  "followers",
  "possibleDuplicates",
  "duplicateDecisions",
  "assignments",
  "referrals",
  "statusEvents",
  "institutionalResponses",
  "resolutionEvidence",
  "verificationRequests",
  "verificationVotes",
  "reopenRequests",
  "moderationCases",
  "auditEvents",
  "notifications",
  "idempotencyKeys",
  "sessions",
  "sequences",
];

function dataDir(): string {
  return process.env.FLM_DATA_DIR ?? path.join(process.cwd(), ".data");
}
function dbFile(): string {
  return path.join(dataDir(), "db.json");
}

function emptyDb(): Database {
  const db = {} as Database;
  for (const c of COLLECTIONS) db[c] = {};
  return db;
}

let cache: Database | null = null;
/** Cola que serializa escrituras (evita carreras entre handlers). */
let writeQueue: Promise<void> = Promise.resolve();

async function load(): Promise<Database> {
  if (cache) return cache;
  try {
    const raw = await fs.readFile(dbFile(), "utf8");
    const parsed = JSON.parse(raw) as Partial<Database>;
    const db = emptyDb();
    for (const c of COLLECTIONS) {
      if (parsed[c]) db[c] = parsed[c] as Record<string, Doc>;
    }
    cache = db;
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === "ENOENT") cache = emptyDb();
    else throw err;
  }
  return cache!;
}

/** Escritura atómica: escribe a tmp y renombra (POSIX rename es atómico). */
async function persist(db: Database): Promise<void> {
  const dir = dataDir();
  await fs.mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `db.json.tmp.${process.pid}.${Date.now()}`);
  await fs.writeFile(tmp, JSON.stringify(db), "utf8");
  await fs.rename(tmp, dbFile());
}

/**
 * Transacción lógica: el mutador recibe el db y sus cambios se persisten
 * atómicamente. Las escrituras se serializan para evitar condiciones de carrera.
 */
export function transact<T>(fn: (db: Database) => T | Promise<T>): Promise<T> {
  const run = writeQueue.then(async () => {
    const db = await load();
    const result = await fn(db);
    await persist(db);
    return result;
  });
  // La cola nunca se rompe por un error individual.
  writeQueue = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

/** Lectura (sin bloqueo de escritura; suficiente para el adaptador demo). */
export async function read<T>(fn: (db: Database) => T | Promise<T>): Promise<T> {
  const db = await load();
  return fn(db);
}

export function newId(): string {
  return crypto.randomUUID();
}

export function nowIso(): string {
  return new Date().toISOString();
}

/** Secuencia atómica por clave (para códigos públicos FLM-PUD-000123). */
export async function nextSequence(key: string): Promise<number> {
  return transact((db) => {
    const existing = db.sequences[key] as unknown as { id: string; value: number } | undefined;
    const value = (existing?.value ?? 0) + 1;
    db.sequences[key] = { id: key, value } as unknown as Doc;
    return value;
  });
}

/** Solo para tests: reinicia la caché en memoria (no borra el archivo). */
export function __resetCache(): void {
  cache = null;
}

export type { Database, Doc };
