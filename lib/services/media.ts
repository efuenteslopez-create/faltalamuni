/**
 * FLM — Sanitización de imágenes (iteración 2, spec §11).
 *
 * Pipeline único (async, Sharp) para toda imagen que entra al sistema
 * —dataURL JSON o bytes multipart—:
 *
 * 1. Límite de entrada: 5 MB (rechazo temprano, sin decodificar).
 * 2. Decodificación real con Sharp: lo que no decodifica como imagen se
 *    rechaza (no basta con magic bytes).
 * 3. Anti-bomba de descompresión: `limitInputPixels` + tope de dimensiones
 *    (4096 px por lado, 16.7 MP totales).
 * 4. Auto-orientación EXIF (`.rotate()`): la orientación queda aplicada a los
 *    píxeles y el EXIF se descarta.
 * 5. Re-encode al formato real detectado (PNG/JPEG/WEBP): elimina metadatos
 *    (EXIF, GPS, XMP, comentarios) y cualquier payload trailing anexado al
 *    archivo original. Sin `.withMetadata()`: la salida nunca lleva metadatos.
 * 6. El MIME final es el del contenido real decodificado.
 *
 * Solo se almacena la salida sanitizada (bytes/dataURL). Sanitizar dos veces
 * es idempotente en validez (la segunda pasada no encuentra metadatos).
 */
import sharp, { type Metadata } from "sharp";
import { DomainError } from "@/lib/domain/types";

/** Máximo de bytes de entrada (antes de decodificar). */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
/** Máxima dimensión por lado, en píxeles. */
export const MAX_IMAGE_DIMENSION = 4096;
/** Máximo total de píxeles (anti-bomba de descompresión). */
export const MAX_IMAGE_PIXELS = 16_777_216; // 4096^2

export type SanitizedMimeType = "image/png" | "image/jpeg" | "image/webp";

export interface SanitizedImage {
  /** MIME del contenido real decodificado (no del declarado). */
  mimeType: SanitizedMimeType;
  /** Tamaño en bytes de la imagen sanitizada. */
  sizeBytes: number;
  /** Bytes sanitizados (re-encodeados, sin metadatos). */
  bytes: Buffer;
  /** dataURL listo para almacenar. */
  dataUrl: string;
}

const MIME_BY_SHARP_FORMAT: Record<string, SanitizedMimeType> = {
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

function invalidImage(message: string): DomainError {
  return new DomainError("INVALID_IMAGE", message);
}

/**
 * Sanitiza bytes crudos de imagen. Lanza DomainError (INVALID_IMAGE o
 * IMAGE_TOO_LARGE) si no son una imagen válida soportada.
 */
export async function sanitizeImageBytes(bytes: Buffer): Promise<SanitizedImage> {
  if (bytes.length === 0) {
    throw invalidImage("El archivo de imagen está vacío");
  }
  if (bytes.length > MAX_IMAGE_BYTES) {
    throw new DomainError(
      "IMAGE_TOO_LARGE",
      `La imagen supera el máximo de ${MAX_IMAGE_BYTES / 1024 / 1024} MB`
    );
  }

  // Decodificación real + límites anti-bomba (limitInputPixels se aplica al
  // leer el encabezado).
  let meta: Metadata;
  try {
    meta = await sharp(bytes, { limitInputPixels: MAX_IMAGE_PIXELS }).metadata();
  } catch (err) {
    // Bomba de descompresión: el encabezado declara más píxeles que el límite.
    if (/pixel limit/i.test((err as Error)?.message ?? "")) {
      throw new DomainError(
        "IMAGE_TOO_LARGE",
        "La imagen supera el máximo de píxeles permitido"
      );
    }
    throw invalidImage("El archivo no es una imagen válida o está corrupto");
  }
  const mimeType = MIME_BY_SHARP_FORMAT[meta.format ?? ""];
  if (!mimeType) {
    throw invalidImage(
      "Formato no soportado: solo se aceptan PNG, JPEG o WEBP"
    );
  }
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  if (width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION) {
    throw new DomainError(
      "IMAGE_TOO_LARGE",
      `La imagen supera las dimensiones máximas de ${MAX_IMAGE_DIMENSION}px por lado`
    );
  }
  if (width * height > MAX_IMAGE_PIXELS) {
    throw new DomainError(
      "IMAGE_TOO_LARGE",
      "La imagen supera el máximo de píxeles permitido"
    );
  }

  // Auto-orientación EXIF + re-encode. Sin withMetadata(): la salida no lleva
  // EXIF/GPS/XMP y el trailing payload del original se descarta.
  let out: Buffer;
  try {
    const pipeline = sharp(bytes, { limitInputPixels: MAX_IMAGE_PIXELS }).rotate();
    const encoded =
      mimeType === "image/png"
        ? pipeline.png()
        : mimeType === "image/jpeg"
          ? pipeline.jpeg({ quality: 82 })
          : pipeline.webp({ quality: 82 });
    out = await encoded.toBuffer();
  } catch {
    throw invalidImage("No se pudo procesar la imagen (archivo corrupto)");
  }

  return {
    mimeType,
    sizeBytes: out.length,
    bytes: out,
    dataUrl: `data:${mimeType};base64,${out.toString("base64")}`,
  };
}

const DATA_URL_RE = /^data:([a-zA-Z0-9/+.]+);base64,([A-Za-z0-9+/=]+)$/;

/**
 * Sanitiza un dataURL de imagen. El MIME declarado debe ser uno soportado y
 * coincidir con el contenido real decodificado.
 */
export async function sanitizeImageDataUrl(dataUrl: string): Promise<SanitizedImage> {
  const match = DATA_URL_RE.exec(dataUrl.trim());
  if (!match) {
    throw invalidImage(
      "Se esperaba un dataURL base64 de imagen (data:image/...;base64,...)"
    );
  }
  const declared = match[1].toLowerCase();
  if (
    declared !== "image/png" &&
    declared !== "image/jpeg" &&
    declared !== "image/webp"
  ) {
    throw invalidImage(
      "Formato no soportado: solo se aceptan PNG, JPEG o WEBP"
    );
  }
  const bytes = Buffer.from(match[2], "base64");
  const sanitized = await sanitizeImageBytes(bytes);
  if (sanitized.mimeType !== declared) {
    throw invalidImage(
      `El tipo declarado (${declared}) no coincide con el contenido (${sanitized.mimeType})`
    );
  }
  return sanitized;
}
