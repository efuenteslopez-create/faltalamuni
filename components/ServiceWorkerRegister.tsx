"use client";

import { useEffect } from "react";

/** Registra el service worker (solo en producción; en dev se omite). */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (
      typeof window !== "undefined" &&
      "serviceWorker" in navigator &&
      process.env.NODE_ENV === "production"
    ) {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // Registro opcional; la app funciona sin SW.
      });
    }
  }, []);
  return null;
}
