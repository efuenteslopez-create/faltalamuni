"use client";

import { useEffect, useState } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DISMISSED_KEY = "flm.install-dismissed.v1";

/**
 * Aviso de instalación PWA no invasivo: solo aparece si el navegador dispara
 * `beforeinstallprompt`, la app no está instalada y no se descartó antes.
 */
export function InstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    const isInstalled =
      window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as unknown as { standalone?: boolean }).standalone === true;
    if (isInstalled) return;
    let stored = false;
    try {
      stored = window.localStorage.getItem(DISMISSED_KEY) === "1";
    } catch {
      /* noop */
    }
    if (stored) return;

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
      setDismissed(false);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  async function install() {
    if (!deferred) return;
    await deferred.prompt();
    await deferred.userChoice;
    setDeferred(null);
    setDismissed(true);
  }

  function dismiss() {
    setDismissed(true);
    try {
      window.localStorage.setItem(DISMISSED_KEY, "1");
    } catch {
      /* noop */
    }
  }

  if (dismissed || !deferred) return null;

  return (
    <div
      role="dialog"
      aria-label="Instalar la aplicación"
      className="fixed inset-x-4 bottom-20 z-40 mx-auto max-w-md rounded-2xl border border-flm-line bg-flm-surface p-4 shadow-pop md:bottom-6"
    >
      <p className="font-bold text-flm-ink">Lleva Falta la Muni contigo</p>
      <p className="mt-1 text-sm text-flm-muted">
        Instala la app para reportar más rápido, incluso con poca señal.
      </p>
      <div className="mt-3 flex gap-2">
        <button type="button" onClick={install} className="flm-btn-primary flex-1 !min-h-[44px] text-sm">
          Instalar
        </button>
        <button
          type="button"
          onClick={dismiss}
          className="flm-btn-secondary !min-h-[44px] px-4 text-sm"
        >
          Ahora no
        </button>
      </div>
    </div>
  );
}
