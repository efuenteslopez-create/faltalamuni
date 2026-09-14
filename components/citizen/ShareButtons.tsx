"use client";

import { useState } from "react";
import { Button } from "@/components/ui/primitives";

/** Botones para compartir un reporte: WhatsApp, compartir nativo y copiar enlace. */
export function ShareButtons({ code, title }: { code: string; title: string }) {
  const [copied, setCopied] = useState(false);

  const url =
    typeof window !== "undefined"
      ? `${window.location.origin}/reportes/${encodeURIComponent(code)}`
      : `/reportes/${encodeURIComponent(code)}`;
  const text = `Mira este reporte en Falta la Muni: "${title}" (${code}) ${url}`;
  const whatsappHref = `https://wa.me/?text=${encodeURIComponent(text)}`;
  const canNativeShare =
    typeof navigator !== "undefined" && "share" in navigator;

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(false);
    }
  }

  async function nativeShare() {
    try {
      await navigator.share({ title: `Falta la Muni · ${code}`, text, url });
    } catch {
      /* el usuario canceló */
    }
  }

  return (
    <div className="flex flex-wrap gap-2">
      <a
        href={whatsappHref}
        target="_blank"
        rel="noopener noreferrer"
        className="flm-btn-primary"
        aria-label="Compartir por WhatsApp"
      >
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden>
          <path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm5.2 14.2c-.2.6-1.3 1.2-1.8 1.2-.5.1-1 .2-3.4-.7-2.9-1.2-4.7-4.1-4.9-4.3-.1-.2-1.1-1.5-1.1-2.9s.7-2 1-2.3c.2-.3.5-.3.7-.3h.5c.2 0 .4 0 .6.5s.8 1.9.8 2c.1.1.1.3 0 .5-.3.6-.6.8-.4 1.1.6 1.1 1.4 1.9 2.5 2.4.3.2.5.1.7-.1l.8-.9c.2-.3.4-.2.7-.1l2 1c.3.1.5.2.6.4 0 .1 0 .6-.2 1.5z" />
        </svg>
        WhatsApp
      </a>
      {canNativeShare && (
        <Button type="button" variant="secondary" onClick={nativeShare}>
          Compartir
        </Button>
      )}
      <Button type="button" variant="secondary" onClick={copyLink} aria-live="polite">
        {copied ? "¡Enlace copiado!" : "Copiar enlace"}
      </Button>
    </div>
  );
}
