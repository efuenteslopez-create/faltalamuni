/**
 * FLM — Auth demo (spec §10/§14).
 *
 * Implementación actual: sesiones con cookie httpOnly firmada (HMAC-SHA256),
 * hash de contraseña con scrypt de Node, sesiones revocables en el adaptador.
 * Ruta de migración a Supabase Auth documentada en docs/ARCHITECTURE.md.
 */
import { scrypt, randomBytes, timingSafeEqual, createHmac } from "crypto";
import { promisify } from "util";
import { cookies } from "next/headers";
import { transact, read, newId, nowIso } from "@/lib/db/store";
import { Role, User } from "@/lib/domain/types";

const scryptAsync = promisify(scrypt);
export const SESSION_COOKIE = "flm_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14; // 14 días

function sessionSecret(): string {
  const s = process.env.FLM_SESSION_SECRET;
  if (!s) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("FLM_SESSION_SECRET es obligatorio en producción");
    }
    // Solo desarrollo/tests. Documentado en .env.example.
    return "dev-only-secret-no-usar-en-produccion";
  }
  return s;
}

/** Hash scrypt con sal aleatoria: formato scrypt$<salt>$<hash> */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = (await scryptAsync(password, salt, 64)) as Buffer;
  return `scrypt$${salt}$${derived.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const [, salt, hashHex] = parts;
  const derived = (await scryptAsync(password, salt, 64)) as Buffer;
  const expected = Buffer.from(hashHex, "hex");
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}

function sign(value: string): string {
  return createHmac("sha256", sessionSecret()).update(value).digest("hex");
}

export interface SessionDoc {
  id: string;
  userId: string;
  createdAt: string;
  expiresAt: string;
}

export async function createSession(userId: string): Promise<string> {
  const id = newId();
  const now = Date.now();
  await transact((db) => {
    db.sessions[id] = {
      id,
      userId,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + SESSION_TTL_MS).toISOString(),
    };
  });
  return `${id}.${sign(id)}`;
}

export async function destroySession(token: string): Promise<void> {
  const [id] = token.split(".");
  if (!id) return;
  await transact((db) => {
    delete db.sessions[id];
  });
}

function parseToken(token: string): string | null {
  const [id, sig] = token.split(".");
  if (!id || !sig) return null;
  const expected = sign(id);
  const a = Buffer.from(sig, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return id;
}

export interface AuthContext {
  user: User;
  role: Role;
}

/** Lee la sesión desde la cookie httpOnly. Retorna null si no hay sesión válida. */
export async function getAuth(): Promise<AuthContext | null> {
  const cookieStore = cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const sessionId = parseToken(token);
  if (!sessionId) return null;

  const session = await read(
    (db) => db.sessions[sessionId] as unknown as SessionDoc | undefined
  );
  if (!session) return null;
  if (new Date(session.expiresAt).getTime() < Date.now()) {
    await destroySession(token);
    return null;
  }
  const user = await read(
    (db) => db.users[session.userId] as unknown as User | undefined
  );
  if (!user) return null;
  return { user, role: user.role };
}

/** Requiere autenticación; lanza con code=UNAUTHENTICATED si falta. */
export async function requireAuth(): Promise<AuthContext> {
  const auth = await getAuth();
  if (!auth) {
    const err = new Error("Se requiere iniciar sesión");
    (err as Error & { code: string }).code = "UNAUTHENTICATED";
    throw err;
  }
  return auth;
}

export function setSessionCookie(token: string): void {
  const cookieStore = cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
}

export function clearSessionCookie(): void {
  const cookieStore = cookies();
  cookieStore.set(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

/** Datos mínimos para crear un usuario (usado por seed y registro). */
export async function createUser(input: {
  email: string;
  password: string;
  displayName: string;
  role?: Role;
}): Promise<User> {
  const passwordHash = await hashPassword(input.password);
  const user: User = {
    id: newId(),
    email: input.email.toLowerCase().trim(),
    passwordHash,
    role: input.role ?? "RESIDENT",
    displayName: input.displayName,
    verifiedResident: false,
    createdAt: nowIso(),
  };
  await transact((db) => {
    db.users[user.id] = user as unknown as Record<string, unknown> & { id: string };
  });
  return user;
}

export async function findUserByEmail(email: string): Promise<User | undefined> {
  const normalized = email.toLowerCase().trim();
  return read((db) => {
    const users = Object.values(db.users) as unknown as User[];
    return users.find((u) => u.email === normalized);
  });
}

export { nowIso };
