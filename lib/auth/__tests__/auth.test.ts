/**
 * FLM — Tests de seguridad: lib/auth (equipo seguridad-qa-docs).
 *
 * Cubre: hash/verify scrypt, firma de sesión (válida, manipulada, expirada),
 * expiración deslizante opt-in, tope de sesiones por usuario, lista de
 * sesiones, y validación/normalización de email + política de password.
 *
 * `next/headers` se mockea con un cookie-jar en memoria porque fuera de un
 * request de Next no existe el contexto de cookies.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const cookieJar = new Map<string, string>();

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = cookieJar.get(name);
      return value === undefined ? undefined : { name, value };
    },
    set: (name: string, value: string) => {
      cookieJar.set(name, value);
    },
  }),
}));

import {
  hashPassword,
  verifyPassword,
  createSession,
  destroySession,
  getAuth,
  setSessionCookie,
  clearSessionCookie,
  createUser,
  findUserByEmail,
  listSessions,
  normalizeEmail,
  assertValidEmail,
  assertPasswordPolicy,
  SESSION_COOKIE,
  MAX_ACTIVE_SESSIONS,
} from "@/lib/auth/auth";
import type { SessionDoc } from "@/lib/auth/auth";
import { __resetCache, transact, read } from "@/lib/db/store";

const TEST_SECRET = "test-secret-fijo-de-al-menos-32-chars";

let dataDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "flm-auth-test-"));
  process.env.FLM_DATA_DIR = dataDir;
  process.env.FLM_SESSION_SECRET = TEST_SECRET;
  process.env.FLM_SESSION_SLIDING = "false";
  __resetCache();
  cookieJar.clear();
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
  delete process.env.FLM_DATA_DIR;
});

async function seedUser(email = "vecina@example.cl") {
  return createUser({
    email,
    password: "Secreta123",
    displayName: "Vecina Prueba",
  });
}

describe("hashPassword / verifyPassword (scrypt)", () => {
  it("genera formato scrypt$<salt>$<hash> con sal aleatoria", async () => {
    const a = await hashPassword("Secreta123");
    const b = await hashPassword("Secreta123");
    expect(a).toMatch(/^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
    expect(a).not.toBe(b); // sal distinta
  });

  it("verifica la contraseña correcta y rechaza la incorrecta", async () => {
    const stored = await hashPassword("Secreta123");
    expect(await verifyPassword("Secreta123", stored)).toBe(true);
    expect(await verifyPassword("secreta123", stored)).toBe(false);
    expect(await verifyPassword("", stored)).toBe(false);
  });

  it("rechaza hashes malformados sin lanzar", async () => {
    expect(await verifyPassword("x", "no-es-un-hash")).toBe(false);
    expect(await verifyPassword("x", "sha256$abc$def")).toBe(false);
    expect(await verifyPassword("x", "scrypt$salt")).toBe(false);
  });
});

describe("firma de sesión HMAC-SHA256", () => {
  it("una sesión válida autentica al usuario", async () => {
    const user = await seedUser();
    const token = await createSession(user.id);
    expect(token).toMatch(/^[0-9a-f-]{36}\.[0-9a-f]{64}$/);
    await setSessionCookie(token);

    const auth = await getAuth();
    expect(auth).not.toBeNull();
    expect(auth?.user.id).toBe(user.id);
    expect(auth?.role).toBe("RESIDENT");
  });

  it("rechaza token con firma manipulada", async () => {
    const user = await seedUser();
    const token = await createSession(user.id);
    const [id, sig] = token.split(".");
    const tampered = `${id}.${"0".repeat(sig.length)}`;
    cookieJar.set(SESSION_COOKIE, tampered);
    expect(await getAuth()).toBeNull();
  });

  it("rechaza token con id manipulado", async () => {
    const user = await seedUser();
    const token = await createSession(user.id);
    const [, sig] = token.split(".");
    const fakeId = "00000000-0000-4000-8000-000000000000";
    cookieJar.set(SESSION_COOKIE, `${fakeId}.${sig}`);
    expect(await getAuth()).toBeNull();
  });

  it("rechaza token sin formato id.firma", async () => {
    cookieJar.set(SESSION_COOKIE, "basura-sin-punto");
    expect(await getAuth()).toBeNull();
    cookieJar.set(SESSION_COOKIE, ".");
    expect(await getAuth()).toBeNull();
  });

  it("sin cookie no hay autenticación", async () => {
    expect(await getAuth()).toBeNull();
  });

  it("destroySession revoca la sesión", async () => {
    const user = await seedUser();
    const token = await createSession(user.id);
    await setSessionCookie(token);
    expect(await getAuth()).not.toBeNull();

    await destroySession(token);
    expect(await getAuth()).toBeNull();
  });

  it("clearSessionCookie elimina la cookie", async () => {
    const user = await seedUser();
    await setSessionCookie(await createSession(user.id));
    await clearSessionCookie();
    // maxAge=0: la cookie queda vacía y getAuth la trata como ausente
    expect(cookieJar.get(SESSION_COOKIE)).toBe("");
    expect(await getAuth()).toBeNull();
  });
});

describe("expiración de sesiones", () => {
  it("una sesión expirada no autentica y se destruye", async () => {
    const user = await seedUser();
    const token = await createSession(user.id);
    const [sessionId] = token.split(".");

    await transact((db) => {
      const s = db.sessions[sessionId] as unknown as SessionDoc;
      s.expiresAt = new Date(Date.now() - 1000).toISOString();
    });

    await setSessionCookie(token);
    expect(await getAuth()).toBeNull();

    const stillThere = await read(
      (db) => db.sessions[sessionId] as unknown as SessionDoc | undefined
    );
    expect(stillThere).toBeUndefined();
  });

  it("expiración deslizante desactivada por defecto: no extiende", async () => {
    const user = await seedUser();
    const token = await createSession(user.id);
    const [sessionId] = token.split(".");
    const nearExpiry = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    await transact((db) => {
      (db.sessions[sessionId] as unknown as SessionDoc).expiresAt = nearExpiry;
    });

    await setSessionCookie(token);
    expect(await getAuth()).not.toBeNull();
    const after = await read(
      (db) => db.sessions[sessionId] as unknown as SessionDoc
    );
    expect(after.expiresAt).toBe(nearExpiry);
  });

  it("expiración deslizante activada: extiende cuando queda menos de la mitad del TTL", async () => {
    process.env.FLM_SESSION_SLIDING = "true";
    const user = await seedUser();
    const token = await createSession(user.id);
    const [sessionId] = token.split(".");
    const nearExpiry = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    await transact((db) => {
      (db.sessions[sessionId] as unknown as SessionDoc).expiresAt = nearExpiry;
    });

    await setSessionCookie(token);
    expect(await getAuth()).not.toBeNull();
    const after = await read(
      (db) => db.sessions[sessionId] as unknown as SessionDoc
    );
    expect(new Date(after.expiresAt).getTime()).toBeGreaterThan(
      new Date(nearExpiry).getTime()
    );
  });
});

describe("tope y lista de sesiones", () => {
  it(`revoca las más antiguas al superar ${MAX_ACTIVE_SESSIONS} sesiones`, async () => {
    const user = await seedUser();
    const firstToken = await createSession(user.id);
    const [firstId] = firstToken.split(".");
    for (let i = 0; i < MAX_ACTIVE_SESSIONS + 1; i++) {
      await createSession(user.id);
    }
    const sessions = await listSessions(user.id);
    expect(sessions).toHaveLength(MAX_ACTIVE_SESSIONS);
    expect(sessions.map((s) => s.id)).not.toContain(firstId);
  });

  it("listSessions retorna las activas más recientes primero y excluye expiradas", async () => {
    const user = await seedUser();
    const t1 = await createSession(user.id);
    const t2 = await createSession(user.id);
    const t3 = await createSession(user.id);
    const [id1] = t1.split(".");

    // Expira la primera manualmente.
    await transact((db) => {
      (db.sessions[id1] as unknown as SessionDoc).expiresAt = new Date(
        Date.now() - 1000
      ).toISOString();
    });

    const sessions = await listSessions(user.id);
    expect(sessions.map((s) => s.id)).toEqual([
      t3.split(".")[0],
      t2.split(".")[0],
    ]);
  });

  it("listSessions de otro usuario no mezcla sesiones", async () => {
    const a = await seedUser("a@example.cl");
    const b = await seedUser("b@example.cl");
    await createSession(a.id);
    await createSession(b.id);
    expect(await listSessions(a.id)).toHaveLength(1);
    expect(await listSessions(b.id)).toHaveLength(1);
  });
});

describe("normalización y validación de email", () => {
  it("normalizeEmail pasa a minúsculas y recorta", () => {
    expect(normalizeEmail("  Vecina@Ejemplo.CL ")).toBe("vecina@ejemplo.cl");
  });

  it("createUser guarda el email normalizado", async () => {
    const user = await createUser({
      email: "Vecina@Ejemplo.CL",
      password: "Secreta123",
      displayName: "Vecina",
    });
    expect(user.email).toBe("vecina@ejemplo.cl");
  });

  it("findUserByEmail es insensible a mayúsculas y espacios", async () => {
    await seedUser("vecina@example.cl");
    expect(await findUserByEmail("  VECINA@EXAMPLE.CL ")).toMatchObject({
      email: "vecina@example.cl",
    });
    expect(await findUserByEmail("otra@example.cl")).toBeUndefined();
  });

  it("assertValidEmail rechaza formatos inválidos", () => {
    expect(() => assertValidEmail("no-es-email")).toThrowError(
      expect.objectContaining({ code: "INVALID_EMAIL" })
    );
    expect(() => assertValidEmail("a@b")).toThrow();
    expect(() => assertValidEmail("a @b.cl")).toThrow();
    expect(() => assertValidEmail("ok@ejemplo.cl")).not.toThrow();
  });

  it("createUser rechaza email inválido", async () => {
    await expect(
      createUser({ email: "mal", password: "Secreta123", displayName: "X" })
    ).rejects.toMatchObject({ code: "INVALID_EMAIL" });
  });
});

describe("política de contraseña", () => {
  it("assertPasswordPolicy exige mínimo 8 caracteres", () => {
    expect(() => assertPasswordPolicy("1234567")).toThrowError(
      expect.objectContaining({ code: "WEAK_PASSWORD" })
    );
    expect(() => assertPasswordPolicy("12345678")).not.toThrow();
  });

  it("createUser rechaza contraseña corta", async () => {
    await expect(
      createUser({
        email: "corta@example.cl",
        password: "1234567",
        displayName: "Corta",
      })
    ).rejects.toMatchObject({ code: "WEAK_PASSWORD" });
  });
});
