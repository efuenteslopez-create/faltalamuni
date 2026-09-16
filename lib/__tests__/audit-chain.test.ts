/**
 * FLM — Iteración 2: auditoría tamper-evident (cadena de hashes).
 *
 * - Cadena válida: eventos encadenados (previousHash + SHA-256) verifican ok.
 * - Génesis: el primer evento tiene previousHash null.
 * - createdAt estrictamente creciente incluso en el mismo milisegundo.
 * - Detail/acción/actor alterado → la verificación falla.
 * - Evento eliminado → la verificación falla.
 * - Eventos reordenados (createdAt intercambiados) → la verificación falla.
 * - Campos HTTP no fabricables: el login audita actorId/acción del servidor
 *   aunque el body traiga campos forjados.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { transact } from "@/lib/db/store";
import {
  audit,
  buildAuditEventTx,
  hashAuditEvent,
  verifyAuditChain,
  verifyAuditChainInStore,
  readAuditEvents,
} from "@/lib/audit";
import { AuditEvent } from "@/lib/domain/types";
import { createUser, SESSION_COOKIE } from "@/lib/auth/auth";
import { POST as loginPOST } from "@/app/api/auth/login/route";
import { freshDb } from "@/lib/__tests__/support";

// Mock de next/headers: cookies() en memoria para que los handlers de auth
// funcionen fuera del request scope de Next.
const cookieJar = new Map<string, { value: string; options: unknown }>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const e = cookieJar.get(name);
      return e ? { name, value: e.value } : undefined;
    },
    set: (name: string, value: string, options: unknown) => {
      cookieJar.set(name, { value, options });
    },
  }),
}));

beforeEach(() => {
  freshDb();
  cookieJar.clear();
});

async function tamperInStore(
  id: string,
  mutate: (e: AuditEvent) => void
): Promise<void> {
  await transact((db) => {
    const e = db.auditEvents[id] as unknown as AuditEvent;
    mutate(e);
  });
}

describe("cadena de auditoría", () => {
  it("eventos encadenados verifican ok; génesis con previousHash null", async () => {
    await audit({ action: "a.uno", actorId: "u1", entityType: "t", entityId: "e1" });
    await audit({ action: "a.dos", actorId: "u1", entityType: "t", entityId: "e1", detail: { x: 1 } });
    await audit({ action: "a.tres", actorId: null, entityType: "t", entityId: "e2" });

    const events = await readAuditEvents();
    expect(events).toHaveLength(3);
    const sorted = [...events].sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
    expect(sorted[0].previousHash).toBeNull();
    expect(sorted[1].previousHash).toBe(sorted[0].hash);
    expect(sorted[2].previousHash).toBe(sorted[1].hash);
    for (const e of events) {
      expect(e.hash).toBe(hashAuditEvent(e));
    }
    expect(await verifyAuditChainInStore()).toEqual({ ok: true });
  });

  it("createdAt es estrictamente creciente aunque colisionen milisegundos", async () => {
    await transact((db) => {
      for (let i = 0; i < 5; i++) {
        const e = buildAuditEventTx(db, {
          action: `a.${i}`,
          actorId: null,
          entityType: "t",
          entityId: "e",
        });
        db.auditEvents[e.id] = e as unknown as (typeof db.auditEvents)[string];
      }
    });
    const events = await readAuditEvents();
    const sorted = [...events].sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i].createdAt > sorted[i - 1].createdAt).toBe(true);
    }
    expect(await verifyAuditChainInStore()).toEqual({ ok: true });
  });

  it("detail alterado → verificación falla", async () => {
    await audit({ action: "a.uno", actorId: "u1", entityType: "t", entityId: "e1", detail: { monto: 100 } });
    await audit({ action: "a.dos", actorId: "u1", entityType: "t", entityId: "e1" });
    const [first] = await readAuditEvents();
    await tamperInStore(first.id, (e) => {
      e.detail = { monto: 999999 };
    });
    const v = await verifyAuditChainInStore();
    expect(v.ok).toBe(false);
    expect(v.atId).toBe(first.id);
    expect(v.reason).toMatch(/alterado/);
  });

  it("acción o actor alterados → verificación falla", async () => {
    await audit({ action: "report.create", actorId: "u1", entityType: "report", entityId: "r1" });
    await audit({ action: "report.confirm", actorId: "u2", entityType: "report", entityId: "r1" });
    const events = await readAuditEvents();
    const second = [...events].sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))[1];
    await tamperInStore(second.id, (e) => {
      e.action = "report.delete";
      e.actorId = "atacante";
    });
    const v = await verifyAuditChainInStore();
    expect(v.ok).toBe(false);
    expect(v.atId).toBe(second.id);
  });

  it("evento eliminado → verificación falla (enlace roto)", async () => {
    await audit({ action: "a.uno", actorId: "u1", entityType: "t", entityId: "e1" });
    await audit({ action: "a.dos", actorId: "u1", entityType: "t", entityId: "e1" });
    await audit({ action: "a.tres", actorId: "u1", entityType: "t", entityId: "e1" });
    const sorted = (await readAuditEvents()).sort((a, b) =>
      a.createdAt < b.createdAt ? -1 : 1
    );
    await transact((db) => {
      delete db.auditEvents[sorted[1].id];
    });
    const v = await verifyAuditChainInStore();
    expect(v.ok).toBe(false);
    expect(v.atId).toBe(sorted[2].id);
    expect(v.reason).toMatch(/anterior/);
  });

  it("eventos reordenados (createdAt intercambiados) → verificación falla", async () => {
    await audit({ action: "a.primero", actorId: "u1", entityType: "t", entityId: "e1" });
    await audit({ action: "a.segundo", actorId: "u1", entityType: "t", entityId: "e1" });
    const sorted = (await readAuditEvents()).sort((a, b) =>
      a.createdAt < b.createdAt ? -1 : 1
    );
    // Copia intacta ANTES de la manipulación (read devuelve las mismas
    // referencias que viven en el store).
    const pristine = sorted.map((e) => ({ ...e }));
    // El atacante intercambia los timestamps para invertir la narrativa.
    await transact((db) => {
      const a = db.auditEvents[sorted[0].id] as unknown as AuditEvent;
      const b = db.auditEvents[sorted[1].id] as unknown as AuditEvent;
      const tmp = a.createdAt;
      a.createdAt = b.createdAt;
      b.createdAt = tmp;
    });
    expect(await verifyAuditChainInStore()).toEqual(
      expect.objectContaining({ ok: false })
    );
    // Y la cadena intacta sí verifica.
    expect(verifyAuditChain(pristine)).toEqual({ ok: true });
  });

  it("cadena vacía verifica ok", () => {
    expect(verifyAuditChain([])).toEqual({ ok: true });
  });
});

describe("campos de auditoría no fabricables por HTTP", () => {
  it("el login audita actorId/acción del servidor aunque el body traiga campos forjados", async () => {
    const user = await createUser({
      email: "vecino@flm.cl",
      password: "ClaveSegura123",
      displayName: "Vecino",
    });
    const forgedBody = {
      email: "vecino@flm.cl",
      password: "ClaveSegura123",
      // Intento de fabricación: estos campos no existen en el esquema ni se usan.
      actorId: "id-del-atacante",
      role: "PLATFORM_ADMIN",
      action: "auth.soy-admin",
    };
    const res = await loginPOST(
      new NextRequest("http://localhost/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(forgedBody),
      })
    );
    expect(res.status).toBe(200);

    const events = await readAuditEvents();
    const loginEvent = events.find((e) => e.action === "auth.login");
    expect(loginEvent).toBeDefined();
    // actorId y acción provienen del servidor (usuario de la BD), no del body.
    expect(loginEvent!.actorId).toBe(user.id);
    expect(loginEvent!.actorId).not.toBe("id-del-atacante");
    expect(loginEvent!.entityId).toBe(user.id);
    // La cadena completa verifica.
    expect(await verifyAuditChainInStore()).toEqual({ ok: true });
    // Y se fijó cookie de sesión httpOnly.
    expect(cookieJar.get(SESSION_COOKIE)).toBeDefined();
  });
});
