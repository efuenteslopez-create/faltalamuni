/**
 * FLM — Iteración 2: sanitización de imágenes (pipeline Sharp).
 *
 * - Imagen válida → se re-encodea y el dataURL solo contiene bytes sanitizados.
 * - EXIF/GPS/orientación → metadatos eliminados, orientación aplicada a píxeles.
 * - Trailing payload → descartado.
 * - Imagen corrupta / formato no soportado / MIME declarado distinto → rechazo.
 * - Dimensiones o píxeles excesivos (bomba de descompresión) → rechazo.
 * - Más de 5 MB → rechazo temprano.
 */
import { describe, it, expect } from "vitest";
import sharp from "sharp";
import {
  sanitizeImageBytes,
  sanitizeImageDataUrl,
  MAX_IMAGE_BYTES,
  MAX_IMAGE_DIMENSION,
} from "@/lib/services/media";
import { DomainError } from "@/lib/domain/types";
import { PNG_1PX } from "@/lib/__tests__/support";

const PNG_1PX_BYTES = Buffer.from(PNG_1PX.split(",")[1], "base64");

async function expectCode(
  promise: Promise<unknown>,
  code: string
): Promise<DomainError> {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(DomainError);
    expect((err as DomainError).code).toBe(code);
    return err as DomainError;
  }
  throw new Error(`Se esperaba rechazo con code=${code}`);
}

/** JPEG 8x4 con EXIF real: orientación 6 + IFD0 + GPS. */
async function jpegWithExif(): Promise<Buffer> {
  return sharp({
    create: {
      width: 8,
      height: 4,
      channels: 3,
      background: { r: 200, g: 30, b: 30 },
    },
  })
    .jpeg()
    .withMetadata({
      orientation: 6,
      // `GPS` no figura en el tipo `Exif` de sharp, pero libvips escribe el
      // IFD GPS igual (verificado en runtime).
      exif: {
        IFD0: { Make: "TestCam", Model: "X1" },
        GPS: { GPSLatitude: "33/1,26/1,0/1", GPSLongitude: "70/1,44/1,0/1" },
      } as unknown as { IFD0: Record<string, string> },
    })
    .toBuffer();
}

describe("sanitizeImageBytes", () => {
  it("imagen válida → re-encodea y entrega dataURL sanitizado", async () => {
    const out = await sanitizeImageBytes(PNG_1PX_BYTES);
    expect(out.mimeType).toBe("image/png");
    expect(out.dataUrl.startsWith("data:image/png;base64,")).toBe(true);
    expect(out.sizeBytes).toBe(out.bytes.length);
    // La salida es una imagen real legible.
    const meta = await sharp(out.bytes).metadata();
    expect(meta.format).toBe("png");
    expect(meta.width).toBe(1);
    expect(meta.height).toBe(1);
  });

  it("elimina EXIF/GPS y aplica la orientación a los píxeles", async () => {
    const input = await jpegWithExif();
    const inMeta = await sharp(input).metadata();
    expect(inMeta.exif?.length).toBeGreaterThan(0); // el input sí trae EXIF

    const out = await sanitizeImageBytes(input);
    expect(out.mimeType).toBe("image/jpeg");
    const outMeta = await sharp(out.bytes).metadata();
    expect(outMeta.exif).toBeUndefined();
    expect(outMeta.icc).toBeUndefined();
    // Orientación 6 (rotar 90°): 8x4 → 4x8 en píxeles reales.
    expect(outMeta.width).toBe(4);
    expect(outMeta.height).toBe(8);
  });

  it("descarta trailing payload anexado al archivo", async () => {
    const marker = Buffer.from("TRAILING-PAYLOAD-MALICIOSO-12345");
    const input = Buffer.concat([PNG_1PX_BYTES, marker]);
    const out = await sanitizeImageBytes(input);
    expect(out.bytes.includes(marker)).toBe(false);
    // La salida sigue siendo un PNG válido.
    expect((await sharp(out.bytes).metadata()).format).toBe("png");
  });

  it("rechaza imagen corrupta o que no es imagen", async () => {
    await expectCode(
      sanitizeImageBytes(Buffer.from("esto no es una imagen")),
      "INVALID_IMAGE"
    );
    await expectCode(sanitizeImageBytes(Buffer.alloc(0)), "INVALID_IMAGE");
    // PNG truncado (solo encabezado).
    await expectCode(
      sanitizeImageBytes(PNG_1PX_BYTES.subarray(0, 20)),
      "INVALID_IMAGE"
    );
  });

  it("rechaza formato no soportado (GIF)", async () => {
    const gif = await sharp({
      create: {
        width: 2,
        height: 2,
        channels: 3,
        background: { r: 0, g: 0, b: 255 },
      },
    })
      .gif()
      .toBuffer();
    await expectCode(sanitizeImageBytes(gif), "INVALID_IMAGE");
  });

  it("rechaza dimensiones excesivas y bombas de descompresión", async () => {
    // 5000x3000 = 15 MP: bajo el límite de píxeles pero sobre 4096 px/lado.
    const wide = await sharp({
      create: {
        width: 5000,
        height: 3000,
        channels: 3,
        background: { r: 1, g: 2, b: 3 },
      },
    })
      .png()
      .toBuffer();
    await expectCode(sanitizeImageBytes(wide), "IMAGE_TOO_LARGE");

    // 5000x5000 = 25 MP: bomba de descompresión (archivo chico, píxeles enormes).
    const bomb = await sharp({
      create: {
        width: 5000,
        height: 5000,
        channels: 3,
        background: { r: 9, g: 9, b: 9 },
      },
    })
      .png()
      .toBuffer();
    expect(bomb.length).toBeLessThan(1024 * 1024); // el archivo es chico…
    await expectCode(sanitizeImageBytes(bomb), "IMAGE_TOO_LARGE");

    // En el límite sí pasa: 4096x4096.
    const atLimit = await sharp({
      create: {
        width: MAX_IMAGE_DIMENSION,
        height: MAX_IMAGE_DIMENSION,
        channels: 3,
        background: { r: 5, g: 5, b: 5 },
      },
    })
      .jpeg({ quality: 70 })
      .toBuffer();
    const out = await sanitizeImageBytes(atLimit);
    expect(out.mimeType).toBe("image/jpeg");
  });

  it("rechaza entrada sobre 5 MB sin decodificar", async () => {
    await expectCode(
      sanitizeImageBytes(Buffer.alloc(MAX_IMAGE_BYTES + 1)),
      "IMAGE_TOO_LARGE"
    );
  });
});

describe("sanitizeImageDataUrl", () => {
  it("acepta dataURL válido y lo re-encodea", async () => {
    const out = await sanitizeImageDataUrl(PNG_1PX);
    expect(out.mimeType).toBe("image/png");
    expect(out.dataUrl.startsWith("data:image/png;base64,")).toBe(true);
  });

  it("rechaza MIME declarado distinto del contenido real", async () => {
    const b64 = PNG_1PX.split(",")[1];
    await expectCode(
      sanitizeImageDataUrl(`data:image/jpeg;base64,${b64}`),
      "INVALID_IMAGE"
    );
  });

  it("rechaza dataURL malformado", async () => {
    await expectCode(sanitizeImageDataUrl("no-es-un-dataurl"), "INVALID_IMAGE");
    await expectCode(
      sanitizeImageDataUrl("data:image/png;base64,"),
      "INVALID_IMAGE"
    );
  });

  it("sanitizar dos veces es estable en validez", async () => {
    const once = await sanitizeImageDataUrl(PNG_1PX);
    const twice = await sanitizeImageDataUrl(once.dataUrl);
    expect(twice.mimeType).toBe("image/png");
    const meta = await sharp(twice.bytes).metadata();
    expect(meta.format).toBe("png");
    expect(meta.exif).toBeUndefined();
  });
});
