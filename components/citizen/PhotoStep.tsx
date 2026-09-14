"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/primitives";

/**
 * Paso 1 del wizard: foto del problema.
 *
 * Privacidad: los teléfonos guardan metadatos EXIF en las fotos (incluida la
 * ubicación GPS). No es viable hacer un "strip EXIF" perfecto en cliente sin
 * librerías pesadas, así que redibujamos la imagen en un <canvas> y la
 * exportamos como JPEG: el canvas solo conserva los píxeles y descarta todos
 * los metadatos (GPS, modelo del teléfono, fecha, etc.). Además se reduce a
 * un tamaño razonable para no saturar conexiones móviles.
 */
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB
const MAX_DIM = 1600;

async function fileToCleanJpeg(file: File): Promise<string> {
  let bitmap: ImageBitmap;
  try {
    // Respeta la orientación guardada por la cámara (fotos verticales).
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    bitmap = await createImageBitmap(file);
  }
  try {
    const scale = Math.min(1, MAX_DIM / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas no disponible");
    ctx.drawImage(bitmap, 0, 0, w, h);
    return canvas.toDataURL("image/jpeg", 0.85);
  } finally {
    bitmap.close();
  }
}

export function PhotoStep({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (dataUrl: string | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);

  async function handleFile(file: File | undefined) {
    setError(null);
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("El archivo debe ser una foto (JPG o PNG).");
      return;
    }
    if (file.size > MAX_BYTES) {
      setError("La foto es muy pesada (máximo 10 MB). Prueba con otra.");
      return;
    }
    setProcessing(true);
    try {
      const dataUrl = await fileToCleanJpeg(file);
      onChange(dataUrl);
    } catch {
      setError("No pudimos procesar la foto. Intenta con otra imagen.");
    } finally {
      setProcessing(false);
    }
  }

  return (
    <div>
      <p className="text-sm text-flm-muted">
        Una foto ayuda a que la municipalidad entienda el problema más rápido.
        Se eliminan los datos privados de la imagen (como la ubicación del
        teléfono) antes de subirla.
      </p>

      <input
        ref={inputRef}
        id="report-photo"
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        aria-describedby="photo-help"
        onChange={(e) => {
          void handleFile(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <p id="photo-help" className="sr-only">
        Toma una foto con la cámara o elige una imagen de tu galería.
      </p>

      {value ? (
        <div className="mt-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={value}
            alt="Vista previa de la foto del problema"
            className="max-h-72 w-full rounded-2xl border border-flm-line object-cover"
          />
          <div className="mt-3 flex gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => inputRef.current?.click()}
              disabled={processing}
            >
              Cambiar foto
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onChange(null)}
              disabled={processing}
            >
              Quitar
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-4">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={processing}
            className="flex min-h-[160px] w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-flm-line bg-flm-surface px-4 py-8 text-flm-muted transition hover:border-flm-accent hover:text-flm-accent disabled:opacity-50"
          >
            <svg viewBox="0 0 24 24" className="h-10 w-10" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
              <path d="M4 8h3l2-3h6l2 3h3v12H4V8z" strokeLinejoin="round" />
              <circle cx="12" cy="13" r="3.5" />
            </svg>
            <span className="text-base font-semibold">
              {processing ? "Procesando foto…" : "Tomar foto o elegir imagen"}
            </span>
            <span className="text-sm">La foto es opcional, pero ayuda mucho</span>
          </button>
        </div>
      )}

      {error && (
        <p role="alert" className="mt-3 text-sm font-medium text-flm-pending">
          {error}
        </p>
      )}
    </div>
  );
}
