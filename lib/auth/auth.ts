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

/**
 * Tope de sesiones activas por usuario: al crear una nueva se revocan las
 * más antiguas. Mitiga acumulación de sesiones en dispositivos compartidos.
 */
export const MAX_ACTIVE_SESSIONS = 10;

/** Expiración deslizante opt-in vía env (default: desactivada). */
function slidingEnabled(): boolean {
  return process.env.FLM_SESSION_SLIDING === "true";
}

/** Normaliza un email para comparación y almacenamiento (minúsculas + trim). */
export function normalizeEmail(email: string): string {
  return email.toLowerCase().trim();
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Validación de formato de email en capa de servicio (defensa en profundidad:
 * los handlers ya validan con Zod). Lanza con code=INVALID_EMAIL.
 */
export function assertValidEmail(email: string): void {
  if (!EMAIL_RE.test(email)) {
    const err = new Error("Email inválido");
    (err as Error & { code: string }).code = "INVALID_EMAIL";
    throw err;
  }
}

/** Largo mínimo de contraseña (el schema de registro ya lo exige; esto es defensa en profundidad). */
export const MIN_PASSWORD_LENGTH = 8;

export function assertPasswordPolicy(password: string): void {
  if (password.length < MIN_PASSWORD_LENGTH) {
    const err = new Error(
      `La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres`
    );
    (err as Error & { code: string }).code = "WEAK_PASSWORD";
    throw err;
  }
}

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
    // Revoca las sesiones más antiguas si se supera el tope por usuario.
    const mine = (Object.values(db.sessions) as unknown as SessionDoc[])
      .filter((s) => s.userId === userId)
      .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
    while (mine.length >= MAX_ACTIVE_SESSIONS) {
      const oldest = mine.shift();
      if (oldest) delete db.sessions[oldest.id];
    }
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
  return getAuthFromToken(token ?? null);
}

/**
 * Núcleo de validación de sesión a partir de un token explícito. Permite
 * resolver el actor desde un Request concreto (tests de integración de los
 * handlers reales) sin depender del contexto `next/headers`.
 */
export async function getAuthFromToken(
  token: string | null
): Promise<AuthContext | null> {
  if (!token) return null;
  const sessionId = parseToken(token);
  if (!sessionId) return null;

  const session = await read(
    (db) => db.sessions[sessionId] as unknown as SessionDoc | undefined
  );
  if (!session) return null;
  const expiresAtMs = new Date(session.expiresAt).getTime();
  if (expiresAtMs < Date.now()) {
    await destroySession(token);
    return null;
  }
  // Expiración deslizante (opt-in): si queda menos de la mitad del TTL,
  // extiende la sesión otro período completo de actividad.
  if (slidingEnabled() && expiresAtMs - Date.now() < SESSION_TTL_MS / 2) {
    await transact((db) => {
      const s = db.sessions[sessionId] as unknown as SessionDoc | undefined;
      if (s) {
        s.expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
      }
    });
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
  const email = normalizeEmail(input.email);
  assertValidEmail(email);
  assertPasswordPolicy(input.password);
  const passwordHash = await hashPassword(input.password);
  const user: User = {
    id: newId(),
    email,
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
  const normalized = normalizeEmail(email);
  return read((db) => {
    const users = Object.values(db.users) as unknown as User[];
    return users.find((u) => u.email === normalized);
  });
}

/**
 * Lista las sesiones activas (no expiradas) de un usuario, más recientes
 * primero. Base para una futura pantalla "Mis sesiones" con revocación.
 */
export async function listSessions(userId: string): Promise<SessionDoc[]> {
  const now = Date.now();
  return read((db) =>
    (Object.values(db.sessions) as unknown as SessionDoc[])
      .filter(
        (s) => s.userId === userId && new Date(s.expiresAt).getTime() >= now
      )
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  );
}

export { nowIso };
