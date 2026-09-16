/**
 * FLM — Contratos de seguridad de la API (iteración 2: activados).
 *
 * Ejercitan los handlers reales bajo `app/api/**` con `NextRequest` y
 * cookies de sesión firmadas; `next/headers` se mockea en memoria para que
 * `setSessionCookie` funcione fuera del request scope de Next.
 *
 * Aislamiento de rate limiting: `FLM_TRUST_PROXY=true` y una IP
 * `x-forwarded-for` distinta por test, de modo que cada bucket es propio del
 * test (sin la confianza activada todas las IPs serían "unknown" y los
 * buckets se contaminarían entre tests).
 *
 * Desviaciones respecto del plan original (escrito antes de que existieran
 * los handlers): `INVALID_TRANSITION` se mapea a 400 (no 422) y
 * `IMAGE_TOO_LARGE` a 400 con código propio (no 413). Los tests afirman el
 * comportamiento real; el cambio de códigos sería una decisión de producto
 * fuera del alcance de esta iteración.
 */
import { describe, it, expect, beforeEach, vi, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { newId, transact } from "@/lib/db/store";
import { createUser, createSession, SESSION_COOKIE } from "@/lib/auth/auth";
import { POST as loginPOST } from "@/app/api/auth/login/route";
import { POST as registerPOST } from "@/app/api/auth/register/route";
import {
  POST as reportsPOST,
} from "@/app/api/reports/route";
import { POST as evidencePOST } from "@/app/api/reports/[code]/evidence/route";
import { POST as transitionsPOST } from "@/app/api/reports/[code]/transitions/route";
import { GET as inboxGET } from "@/app/api/panel/inbox/route";
import { GET as healthGET } from "@/app/api/health/route";
import { freshDb } from "@/lib/__tests__/support";
import { User } from "@/lib/domain/types";

// Mock de next/headers: cookies() en memoria; expone el jar para aserciones
// sobre los atributos de la cookie de sesión.
const cookieJar = new Map<string, { value: string; options: Record<string, unknown> }>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const e = cookieJar.get(name);
      return e ? { name, value: e.value } : undefined;
    },
    set: (name: string, value: string, options: Record<string, unknown> = {}) => {
      cookieJar.set(name, { value, options });
    },
  }),
}));

process.env.FLM_TRUST_PROXY = "true";
afterAll(() => {
  delete process.env.FLM_TRUST_PROXY;
});

const LOC = { lng: -70.7489, lat: -33.4408 };

function seedCatalog(): Promise<void> {
  return transact((db) => {
    db.municipalities["mun-c"] = {
      id: "mun-c",
      name: "Pudahuel",
      prefix: "PUD",
      center: LOC,
      createdAt: new Date().toISOString(),
    } as unknown as (typeof db.municipalities)[string];
    db.categories["cat-c"] = {
      id: "cat-c",
      slug: "basural",
      name: "Basural",
      icon: "trash",
      sensitiveLocation: false,
    } as unknown as (typeof db.categories)[string];
  });
}

beforeEach(async () => {
  freshDb();
  cookieJar.clear();
  await seedCatalog();
});

function reqJson(
  url: string,
  body: unknown,
  opts: { ip?: string; token?: string; idempotencyKey?: string } = {}
): NextRequest {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.ip) headers["x-forwarded-for"] = opts.ip;
  if (opts.token) headers["cookie"] = `${SESSION_COOKIE}=${opts.token}`;
  if (opts.idempotencyKey) headers["idempotency-key"] = opts.idempotencyKey;
  return new NextRequest(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

async function makeResident(
  email: string,
  password = "ClaveSegura123"
): Promise<{ user: User; token: string }> {
  const user = await createUser({ email, password, displayName: "Vecino" });
  const token = await createSession(user.id);
  return { user, token };
}

function validReportBody(extra: Record<string, unknown> = {}) {
  return {
    categoryId: "cat-c",
    municipalityId: "mun-c",
    title: "Microbasural en sitio eriazo",
    description: "Se acumula basura y escombros hace semanas en la esquina.",
    location: LOC,
    ...extra,
  };
}

describe("API: contratos de seguridad", () => {
  it("POST /api/auth/login aplica rate limit por IP y no enumera usuarios", async () => {
    const IP = "10.9.1.1";
    await makeResident("existe@flm.cl");

    // 1) Rate limit: 30 intentos/min por IP → el 31º responde 429.
    let last: Response | undefined;
    for (let i = 0; i < 31; i++) {
      last = await loginPOST(
        reqJson("http://localhost/api/auth/login", {
          email: `rl-${i}@flm.cl`,
          password: "incorrecta",
        }, { ip: IP })
      );
    }
    expect(last!.status).toBe(429);
    const rlBody = await last!.json();
    expect(rlBody.ok).toBe(false);
    expect(rlBody.error.code).toBe("RATE_LIMITED");
    const retryAfter = last!.headers.get("Retry-After");
    expect(retryAfter).not.toBeNull();
    expect(Number(retryAfter)).toBeGreaterThan(0);

    // 2) Sin enumeración: email inexistente vs password incorrecta responden
    // idéntico (mismo status, mismo código, mismo mensaje).
    const IP2 = "10.9.1.11";
    const noUser = await loginPOST(
      reqJson("http://localhost/api/auth/login", {
        email: "nadie@flm.cl",
        password: "ClaveSegura123",
      }, { ip: IP2 })
    );
    const wrongPw = await loginPOST(
      reqJson("http://localhost/api/auth/login", {
        email: "existe@flm.cl",
        password: "otra-clave",
      }, { ip: IP2 })
    );
    expect(noUser.status).toBe(401);
    expect(wrongPw.status).toBe(401);
    const b1 = await noUser.json();
    const b2 = await wrongPw.json();
    expect(b1).toEqual(b2);
    expect(b1.error).toEqual({
      code: "UNAUTHENTICATED",
      message: "Correo o contraseña incorrectos",
    });
  });

  it("POST /api/auth/login y /api/auth/register setean cookie httpOnly/SameSite y nunca exponen el token en el body", async () => {
    // Registro.
    const reg = await registerPOST(
      reqJson("http://localhost/api/auth/register", {
        email: "nuevo@flm.cl",
        password: "ClaveSegura123",
        displayName: "Nuevo Vecino",
      }, { ip: "10.9.1.2" })
    );
    expect(reg.status).toBe(201);
    const regCookie = cookieJar.get(SESSION_COOKIE);
    expect(regCookie).toBeDefined();
    expect(regCookie!.options.httpOnly).toBe(true);
    expect(regCookie!.options.sameSite).toBe("lax");
    expect(regCookie!.options.path).toBe("/");
    // Secure se activa en producción (lib/auth/auth.ts); en test es false.
    expect(regCookie!.options.secure).toBe(process.env.NODE_ENV === "production");
    const regBody = await reg.json();
    expect(JSON.stringify(regBody)).not.toContain(regCookie!.value);

    // Login.
    const login = await loginPOST(
      reqJson("http://localhost/api/auth/login", {
        email: "nuevo@flm.cl",
        password: "ClaveSegura123",
      }, { ip: "10.9.1.3" })
    );
    expect(login.status).toBe(200);
    const loginCookie = cookieJar.get(SESSION_COOKIE);
    expect(loginCookie).toBeDefined();
    expect(loginCookie!.options.httpOnly).toBe(true);
    expect(loginCookie!.options.sameSite).toBe("lax");
    const loginBody = await login.json();
    expect(JSON.stringify(loginBody)).not.toContain(loginCookie!.value);
    expect(loginBody.data.user.email).toBe("nuevo@flm.cl");
  });

  it("todas las mutaciones validan con Zod (400) e ignoran campos extra (sin mass assignment)", async () => {
    const { user, token } = await makeResident("mass@flm.cl");
    const IP = "10.9.1.4";

    // Body inválido → 400 VALIDATION, no 500.
    const bad = await reportsPOST(
      reqJson("http://localhost/api/reports", { title: "x" }, { ip: IP, token })
    );
    expect(bad.status).toBe(400);
    const badBody = await bad.json();
    expect(badBody.ok).toBe(false);
    expect(badBody.error.code).toBe("VALIDATION");

    // Campos extra (role, state, authorId) se ignoran: no hay escalamiento.
    const evil = await reportsPOST(
      reqJson(
        "http://localhost/api/reports",
        validReportBody({
          role: "PLATFORM_ADMIN",
          state: "VERIFIED_RESOLVED",
          authorId: "otro-id",
          verifiedResident: true,
        }),
        { ip: IP, token }
      )
    );
    expect(evil.status).toBe(201);
    const evilBody = await evil.json();
    // El estado forjado se ignora: el sistema aplica su propia publicación
    // (REPORTED → AWAITING_RESPONSE), nunca el "VERIFIED_RESOLVED" inyectado.
    expect(evilBody.data.state).toBe("AWAITING_RESPONSE");
    expect(evilBody.data.state).not.toBe("VERIFIED_RESOLVED");
    // A nivel de dominio: el autor es el de la sesión (no "otro-id") y el
    // usuario sigue siendo RESIDENT (el `role` inyectado se ignoró).
    const storedReport = await transact((db) => {
      const reports = Object.values(db.reports) as unknown as { authorId: string }[];
      return reports[0];
    });
    expect(storedReport.authorId).toBe(user.id);
    const stored = await transact((db) => db.users[user.id] as unknown as User);
    expect(stored.role).toBe("RESIDENT");
  });

  it("rutas protegidas retornan 401 sin sesión y 403 sin capacidad", async () => {
    const { token } = await makeResident("cap@flm.cl");
    const IP = "10.9.1.5";

    // Sin cookie de sesión → 401 UNAUTHENTICATED.
    const anon = await reportsPOST(
      reqJson("http://localhost/api/reports", validReportBody(), { ip: IP })
    );
    expect(anon.status).toBe(401);
    expect((await anon.json()).error.code).toBe("UNAUTHENTICATED");

    // Con sesión de RESIDENT en bandeja institucional → 403 FORBIDDEN.
    const res = await inboxGET(
      new NextRequest("http://localhost/api/panel/inbox", {
        headers: {
          "x-forwarded-for": IP,
          cookie: `${SESSION_COOKIE}=${token}`,
        },
      })
    );
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("FORBIDDEN");
  });

  it("transiciones de estado validan regla, techo institucional y versión", async () => {
    const { token } = await makeResident("trans@flm.cl");
    const IP = "10.9.1.6";
    const created = await reportsPOST(
      reqJson("http://localhost/api/reports", validReportBody(), { ip: IP, token })
    );
    expect(created.status).toBe(201);
    const { code } = (await created.json()).data as { code: string };
    const url = `http://localhost/api/reports/${code}/transitions`;
    const ctx = { params: Promise.resolve({ code }) };

    // Transición no listada (REPORTED → IN_PROGRESS no existe) → 400.
    const invalid = await transitionsPOST(
      reqJson(url, { to: "IN_PROGRESS", expectedVersion: 1 }, { ip: IP, token }),
      ctx
    );
    expect(invalid.status).toBe(400);
    expect((await invalid.json()).error.code).toBe("INVALID_TRANSITION");

    // Techo institucional: ningún actor HTTP puede pedir VERIFIED_RESOLVED.
    const ceiling = await transitionsPOST(
      reqJson(url, { to: "VERIFIED_RESOLVED", expectedVersion: 1 }, { ip: IP, token }),
      ctx
    );
    expect(ceiling.status).toBe(403);
    expect((await ceiling.json()).error.code).toBe("FORBIDDEN");

    // expectedVersion desactualizado → 409 VERSION_CONFLICT.
    const stale = await transitionsPOST(
      reqJson(url, { to: "IN_PROGRESS", expectedVersion: 999 }, { ip: IP, token }),
      ctx
    );
    expect(stale.status).toBe(409);
    expect((await stale.json()).error.code).toBe("VERSION_CONFLICT");
  });

  it("mutaciones críticas respetan Idempotency-Key (reintento = misma respuesta, sin duplicar)", async () => {
    const { token } = await makeResident("idem@flm.cl");
    const IP = "10.9.1.7";
    const key = newId();
    const body = validReportBody();

    const first = await reportsPOST(
      reqJson("http://localhost/api/reports", body, { ip: IP, token, idempotencyKey: key })
    );
    const second = await reportsPOST(
      reqJson("http://localhost/api/reports", body, { ip: IP, token, idempotencyKey: key })
    );
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    const b1 = await first.json();
    const b2 = await second.json();
    expect(b2).toEqual(b1);

    const codes = await transact(
      (db) =>
        (Object.values(db.reports) as unknown as { code: string }[]).map((r) => r.code)
    );
    expect(codes).toHaveLength(1);

    // Misma clave con body distinto → 409 IDEMPOTENCY_CONFLICT.
    const conflict = await reportsPOST(
      reqJson(
        "http://localhost/api/reports",
        validReportBody({ title: "Otro título distinto" }),
        { ip: IP, token, idempotencyKey: key }
      )
    );
    expect(conflict.status).toBe(409);
    expect((await conflict.json()).error.code).toBe("IDEMPOTENCY_CONFLICT");
  });

  it("subida de fotos valida contenido real en servidor (magic bytes y tamaño)", async () => {
    const { token } = await makeResident("img@flm.cl");
    const IP = "10.9.1.8";
    const created = await reportsPOST(
      reqJson("http://localhost/api/reports", validReportBody(), { ip: IP, token })
    );
    expect(created.status).toBe(201);
    const { code } = (await created.json()).data as { code: string };
    const url = `http://localhost/api/reports/${code}/evidence`;
    const ctx = { params: Promise.resolve({ code }) };

    // Magic bytes falsos: declara PNG pero el contenido es texto → 400.
    const fake = await evidencePOST(
      reqJson(url, {
        dataUrl:
          "data:image/png;base64," +
          Buffer.from("esto no es una imagen, solo texto").toString("base64"),
      }, { ip: IP, token }),
      ctx
    );
    expect(fake.status).toBe(400);
    expect((await fake.json()).error.code).toBe("INVALID_IMAGE");

    // Sobre 5 MB → 400 IMAGE_TOO_LARGE (el chequeo de tamaño va antes del decode).
    const big = await evidencePOST(
      reqJson(url, {
        dataUrl:
          "data:image/png;base64," +
          Buffer.alloc(5 * 1024 * 1024 + 1).toString("base64"),
      }, { ip: IP, token }),
      ctx
    );
    expect(big.status).toBe(400);
    expect((await big.json()).error.code).toBe("IMAGE_TOO_LARGE");
  });

  it("GET /api/health no expone información sensible", async () => {
    const res = await healthGET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    const serialized = JSON.stringify(body).toLowerCase();
    expect(serialized).not.toMatch(/version/);
    expect(serialized).not.toMatch(/env/);
    expect(serialized).not.toMatch(/\/home|\/app|node_modules/);
    expect(Object.keys(body).sort()).toEqual(["ok", "service", "time"]);
  });
});
