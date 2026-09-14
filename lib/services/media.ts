/**
 * FLM — Validación de imágenes (spec §11).
 * Solo PNG, JPEG y WEBP, verificados por magic bytes (no por extensión ni por
 * el mime declarado), con un máximo de 5 MB decodificados.
 */
import { DomainError } from "@/lib/domain/types";

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export interface ValidatedImage {
  mimeType: "image/png" | "image/jpeg" | "image/webp";
  sizeBytes: number;
  bytes: Buffer;
}

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_MAGIC = [0xff, 0xd8, 0xff];
// WEBP: "RIFF" .... "WEBP"
const WEBP_RIFF = [0x52, 0x49, 0x46, 0x46];
const WEBP_TAG = [0x57, 0x45, 0x42, 0x50];

function startsWith(bytes: Buffer, magic: number[]): boolean {
  return magic.every((b, i) => bytes[i] === b);
}

function detectMime(bytes: Buffer): ValidatedImage["mimeType"] | null {
  if (bytes.length >= 8 && startsWith(bytes, PNG_MAGIC)) return "image/png";
  if (bytes.length >= 3 && startsWith(bytes, JPEG_MAGIC)) return "image/jpeg";
  if (
    bytes.length >= 12 &&
    startsWith(bytes, WEBP_RIFF) &&
    startsWith(bytes.subarray(8, 12), WEBP_TAG)
  ) {
    return "image/webp";
  }
  return null;
}

/** Valida bytes crudos de imagen. Lanza DomainError si no son válidos. */
export function validateImageBytes(bytes: Buffer): ValidatedImage {
  if (bytes.length === 0) {
    throw new DomainError("INVALID_IMAGE", "El archivo de imagen está vacío");
  }
  if (bytes.length > MAX_IMAGE_BYTES) {
    throw new DomainError(
      "IMAGE_TOO_LARGE",
      `La imagen supera el máximo de ${MAX_IMAGE_BYTES / 1024 / 1024} MB`
    );
  }
  const mimeType = detectMime(bytes);
  if (!mimeType) {
    throw new DomainError(
      "INVALID_IMAGE",
      "Formato no soportado: solo se aceptan PNG, JPEG o WEBP"
    );
  }
  return { mimeType, sizeBytes: bytes.length, bytes };
}

const DATA_URL_RE = /^data:([a-zA-Z0-9/+.]+);base64,([A-Za-z0-9+/=]+)$/;

/**
 * Valida un dataURL de imagen. Retorna mime detectado, tamaño y el dataURL
 * normalizado. El mime declarado debe coincidir con los magic bytes.
 */
export function validateImageDataUrl(dataUrl: string): ValidatedImage & {
  dataUrl: string;
} {
  const match = DATA_URL_RE.exec(dataUrl.trim());
  if (!match) {
    throw new DomainError(
      "INVALID_IMAGE",
      "Se esperaba un dataURL base64 de imagen (data:image/...;base64,...)"
    );
  }
  const declared = match[1].toLowerCase();
  let bytes: Buffer;
  try {
    bytes = Buffer.from(match[2], "base64");
  } catch {
    throw new DomainError("INVALID_IMAGE", "El contenido base64 no es válido");
  }
  const validated = validateImageBytes(bytes);
  if (declared !== validated.mimeType) {
    throw new DomainError(
      "INVALID_IMAGE",
      `El tipo declarado (${declared}) no coincide con el contenido (${validated.mimeType})`
    );
  }
  return { ...validated, dataUrl: `data:${validated.mimeType};base64,${match[2]}` };
}
