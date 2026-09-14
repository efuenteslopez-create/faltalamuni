/**
 * FLM — Tests de seguridad: lib/security (equipo seguridad-qa-docs).
 *
 * Cubre: sanitizeText (trim, colapso de espacios, control chars, tope),
 * isValidImageDataUrl (magic bytes PNG/JPEG/WEBP, límite 5MB, rechazos) y
 * safeRedirect (anti open-redirect).
 */
import { describe, it, expect } from "vitest";
import {
  sanitizeText,
  isValidImageDataUrl,
  safeRedirect,
  MAX_IMAGE_BYTES,
} from "@/lib/security";

function dataUrl(mime: string, bytes: number[]): string {
  return `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;
}

const PNG_BYTES = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01];
const JPEG_BYTES = [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46];
const WEBP_BYTES = [
  0x52, 0x49, 0x46, 0x46, 0x10, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50,
];

describe("sanitizeText", () => {
  it("recorta y colapsa espacios", () => {
    expect(sanitizeText("  hola   mundo  ")).toBe("hola mundo");
    expect(sanitizeText("línea1\n\nlínea2\ttab")).toBe("línea1 línea2 tab");
  });

  it("remueve caracteres de control", () => {
    expect(sanitizeText("hola\u0000mundo\u001f!")).toBe("holamundo!");
  });

  it("trunca al largo máximo", () => {
    expect(sanitizeText("abcdefghij", 5)).toBe("abcde");
    expect(sanitizeText("abc", 5)).toBe("abc");
  });

  it("entrada no-string retorna vacío", () => {
    expect(sanitizeText(null)).toBe("");
    expect(sanitizeText(undefined)).toBe("");
    expect(sanitizeText(123)).toBe("");
  });
});

describe("isValidImageDataUrl", () => {
  it("acepta PNG, JPEG y WEBP reales", () => {
    expect(isValidImageDataUrl(dataUrl("image/png", PNG_BYTES))).toBe(true);
    expect(isValidImageDataUrl(dataUrl("image/jpeg", JPEG_BYTES))).toBe(true);
    expect(isValidImageDataUrl(dataUrl("image/webp", WEBP_BYTES))).toBe(true);
  });

  it("rechaza magic bytes que no calzan con el formato declarado", () => {
    // PNG declarado pero contenido JPEG.
    expect(isValidImageDataUrl(dataUrl("image/png", JPEG_BYTES))).toBe(false);
    // WEBP sin firma RIFF/WEBP.
    expect(isValidImageDataUrl(dataUrl("image/webp", PNG_BYTES))).toBe(false);
    // Texto plano disfrazado de imagen.
    const text = Buffer.from("hola, no soy una imagen").toJSON().data as number[];
    expect(isValidImageDataUrl(dataUrl("image/png", text))).toBe(false);
  });

  it("rechaza formatos no permitidos", () => {
    expect(isValidImageDataUrl(dataUrl("image/gif", PNG_BYTES))).toBe(false);
    expect(isValidImageDataUrl(dataUrl("image/svg+xml", PNG_BYTES))).toBe(false);
  });

  it("rechaza dataURLs malformadas", () => {
    expect(isValidImageDataUrl("https://ejemplo.cl/foto.png")).toBe(false);
    expect(isValidImageDataUrl("data:image/png;base64,")).toBe(false);
    expect(isValidImageDataUrl("data:image/png,AAAA")).toBe(false); // sin ;base64
    expect(isValidImageDataUrl("")).toBe(false);
    expect(isValidImageDataUrl(null)).toBe(false);
  });

  it("rechaza imágenes sobre 5MB", () => {
    const big = new Array(MAX_IMAGE_BYTES + 1).fill(0);
    big[0] = 0x89;
    big[1] = 0x50;
    big[2] = 0x4e;
    big[3] = 0x47;
    big[4] = 0x0d;
    big[5] = 0x0a;
    big[6] = 0x1a;
    big[7] = 0x0a;
    expect(isValidImageDataUrl(dataUrl("image/png", big))).toBe(false);

    const atLimit = new Array(MAX_IMAGE_BYTES).fill(0);
    atLimit.splice(0, 8, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
    expect(isValidImageDataUrl(dataUrl("image/png", atLimit))).toBe(true);
  }, 30000);
});

describe("safeRedirect", () => {
  it("acepta rutas internas relativas", () => {
    expect(safeRedirect("/panel/reportes")).toBe("/panel/reportes");
    expect(safeRedirect("/reporte/123?tab=fotos")).toBe("/reporte/123?tab=fotos");
    expect(safeRedirect("/")).toBe("/");
  });

  it("rechaza URLs absolutas (open-redirect)", () => {
    expect(safeRedirect("https://malicioso.cl")).toBe("/");
    expect(safeRedirect("http://malicioso.cl/phish")).toBe("/");
    expect(safeRedirect("//malicioso.cl")).toBe("/");
    expect(safeRedirect("javascript:alert(1)")).toBe("/");
  });

  it("rechaza backslashes y caracteres de control", () => {
    expect(safeRedirect("/\\malicioso.cl")).toBe("/");
    expect(safeRedirect("/panel\u0000xss")).toBe("/");
  });

  it("usa el fallback para entradas vacías o nulas", () => {
    expect(safeRedirect(null)).toBe("/");
    expect(safeRedirect(undefined)).toBe("/");
    expect(safeRedirect("")).toBe("/");
    expect(safeRedirect("   ")).toBe("/");
    expect(safeRedirect(null, "/panel")).toBe("/panel");
    expect(safeRedirect("https://x.cl", "/panel")).toBe("/panel");
  });
});
