/**
 * FLM — Borrador offline del formulario de reporte.
 * Se guarda en localStorage en cada cambio del wizard. La idempotencyKey se
 * genera UNA sola vez por borrador (crypto.randomUUID) y se reutiliza en cada
 * reintento, para que recuperar la conexión no duplique el reporte.
 */
import type { GeoPoint } from "@/lib/domain/types";

export interface ReportDraft {
  idempotencyKey: string;
  photoDataUrl: string | null;
  location: GeoPoint | null;
  categoryId: string | null;
  title: string;
  description: string;
  anonymousPublic: boolean;
  /** Si quedó pendiente de envío (se publicó sin conexión). */
  pendingSync: boolean;
  updatedAt: string;
}

const KEY = "flm.report-draft.v1";
/** Códigos de reportes creados desde este dispositivo (para "mis reportes"). */
const MY_CODES_KEY = "flm.my-codes.v1";
/** Códigos que el usuario sigue desde este dispositivo. */
const FOLLOWED_KEY = "flm.followed.v1";
/** Códigos que el usuario confirmó ("yo también lo vi") desde este dispositivo. */
const CONFIRMED_KEY = "flm.confirmed.v1";

export function newDraft(): ReportDraft {
  return {
    idempotencyKey:
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `draft-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    photoDataUrl: null,
    location: null,
    categoryId: null,
    title: "",
    description: "",
    anonymousPublic: true,
    pendingSync: false,
    updatedAt: new Date().toISOString(),
  };
}

export function loadDraft(): ReportDraft | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ReportDraft;
    if (!parsed.idempotencyKey) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveDraft(draft: ReportDraft): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      KEY,
      JSON.stringify({ ...draft, updatedAt: new Date().toISOString() })
    );
  } catch {
    // Almacenamiento lleno o bloqueado: el wizard sigue funcionando en memoria.
  }
}

export function clearDraft(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(KEY);
}

function readCodes(key: string): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(key);
    const arr = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(arr) ? arr.filter((c): c is string => typeof c === "string") : [];
  } catch {
    return [];
  }
}

function writeCodes(key: string, codes: string[]): void {
  if (typeof window === "undefined") return;
  try {
    const seen = new Set<string>();
    const unique: string[] = [];
    for (const c of codes) {
      if (!seen.has(c)) {
        seen.add(c);
        unique.push(c);
      }
    }
    window.localStorage.setItem(key, JSON.stringify(unique));
  } catch {
    /* noop */
  }
}

export const myCodes = {
  list: () => readCodes(MY_CODES_KEY),
  add: (code: string) => writeCodes(MY_CODES_KEY, [code, ...readCodes(MY_CODES_KEY)]),
};

export const followedCodes = {
  list: () => readCodes(FOLLOWED_KEY),
  add: (code: string) => writeCodes(FOLLOWED_KEY, [code, ...readCodes(FOLLOWED_KEY)]),
  remove: (code: string) =>
    writeCodes(FOLLOWED_KEY, readCodes(FOLLOWED_KEY).filter((c) => c !== code)),
  has: (code: string) => readCodes(FOLLOWED_KEY).includes(code),
};

export const confirmedCodes = {
  list: () => readCodes(CONFIRMED_KEY),
  add: (code: string) => writeCodes(CONFIRMED_KEY, [code, ...readCodes(CONFIRMED_KEY)]),
  has: (code: string) => readCodes(CONFIRMED_KEY).includes(code),
};
