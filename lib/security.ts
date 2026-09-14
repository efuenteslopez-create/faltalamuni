/**
 * FLM — Utilidades de seguridad de entrada (equipo seguridad-qa-docs).
 *
 * `sanitizeText`: normaliza texto libre antes de persistirlo o mostrarlo
 * (trim, colapso de espacios, remoción de caracteres de control, tope de largo).
 *
 * `isValidImageDataUrl`: valida que un dataURL sea una imagen PNG/JPEG/WEBP
 * real verificando magic bytes tras decodificar base64, con tope de 5MB.
 * Es defensa en profundidad: el schema Zod ya limita el largo del string.
 *
 * `safeRedirect`: evita open-redirects en parámetros `?next=`; solo acepta
 * rutas internas relativas.
 */

const CONTROL_CHARS_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const WHITESPACE_RUN_RE = /\s+/g;

/**
 * Normaliza texto libre: trim, colapsa corridas de espacios (incluye saltos
 * de línea) a un solo espacio, remueve caracteres de control y trunca al
 * largo máximo. Nunca retorna null: entrada no-string retorna "".
 */
export function sanitizeText(input: unknown, maxLength = 2000): string {
  if (typeof input !== "string") return "";
  const cleaned = input
    .replace(CONTROL_CHARS_RE, "")
    .replace(WHITESPACE_RUN_RE, " ")
    .trim();
  return cleaned.length > maxLength ? cleaned.slice(0, maxLength) : cleaned;
}

/** Límite de tamaño para fotos en el MVP (5 MB de bytes decodificados). */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const DATA_URL_RE = /^data:(image\/(png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/;

const MAGIC_PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const MAGIC_JPEG = [0xff, 0xd8, 0xff];
const MAGIC_WEBP_RIFF = [0x52, 0x49, 0x46, 0x46]; // "RIFF"
const MAGIC_WEBP_WEBP = [0x57, 0x45, 0x42, 0x50]; // "WEBP" en offset 8

function matchesMagic(bytes: Uint8Array, magic: number[], offset = 0): boolean {
  if (bytes.length < offset + magic.length) return false;
  return magic.every((b, i) => bytes[offset + i] === b);
}

/**
 * Valida un dataURL de imagen:
 * - prefijo `data:image/<png|jpeg|webp>;base64,`
 * - base64 decodificable
 * - magic bytes reales del formato declarado
 * - tamaño decodificado ≤ 5MB
 *
 * Retorna false para cualquier entrada malformada, sin lanzar.
 */
export function isValidImageDataUrl(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const m = DATA_URL_RE.exec(value.trim());
  if (!m) return false;
  const [, , format, b64] = m;
  let bytes: Buffer;
  try {
    bytes = Buffer.from(b64, "base64");
  } catch {
    return false;
  }
  // Rechaza base64 vacío o que no redondea a los bytes esperados.
  if (bytes.length === 0) return false;
  if (bytes.length > MAX_IMAGE_BYTES) return false;

  switch (format) {
    case "png":
      return matchesMagic(bytes, MAGIC_PNG);
    case "jpeg":
      return matchesMagic(bytes, MAGIC_JPEG);
    case "webp":
      return matchesMagic(bytes, MAGIC_WEBP_RIFF, 0) && matchesMagic(bytes, MAGIC_WEBP_WEBP, 8);
    default:
      return false;
  }
}

/**
 * Sanitiza un destino de redirección (`?next=`): solo acepta rutas internas
 * relativas (empiezan con "/" pero no con "//" ni contienen "\").
 * Cualquier otra cosa retorna el fallback. Evita open-redirects.
 */
export function safeRedirect(
  next: string | null | undefined,
  fallback = "/"
): string {
  if (typeof next !== "string") return fallback;
  const target = next.trim();
  if (target.length === 0) return fallback;
  if (!target.startsWith("/")) return fallback;
  if (target.startsWith("//")) return fallback;
  if (target.includes("\\")) return fallback;
  if (CONTROL_CHARS_RE.test(target)) return fallback;
  return target;
}
