"use client";

import type { JSX } from "react";
import clsx from "clsx";

/**
 * Icono SVG por categoría. El contrato trae `icon` como nombre (sin emoji en
 * UI crítica), así que lo mapeamos a dibujos simples. Si el nombre no se
 * reconoce, se usa un pin genérico.
 */
const PATHS: Record<string, JSX.Element> = {
  baches: (
    <>
      <path d="M3 9h18M5 14h14" strokeLinecap="round" />
      <ellipse cx="12" cy="10" rx="3.5" ry="2.2" />
    </>
  ),
  alumbrado: (
    <>
      <path d="M9 2h6l-2.5 5H15L8 14l1.5-5H6L9 2z" strokeLinejoin="round" />
    </>
  ),
  basura: (
    <>
      <path d="M5 7h14l-1.2 9.2a1.5 1.5 0 0 1-1.5 1.3H7.7a1.5 1.5 0 0 1-1.5-1.3L5 7z" />
      <path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M10 11v5M14 11v5" strokeLinecap="round" />
    </>
  ),
  "areas-verdes": (
    <>
      <path d="M12 21v-8" strokeLinecap="round" />
      <path d="M12 13c0-4 3-7 8-7 0 4-3 7-8 7zM12 13c0-4-3-7-8-7 0 4 3 7 8 7z" strokeLinejoin="round" />
    </>
  ),
  agua: (
    <>
      <path d="M12 3s6 6.3 6 11a6 6 0 0 1-12 0c0-4.7 6-11 6-11z" strokeLinejoin="round" />
    </>
  ),
  transito: (
    <>
      <rect x="9" y="3" width="6" height="14" rx="1.5" />
      <circle cx="12" cy="7" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none" />
      <path d="M12 17v4" strokeLinecap="round" />
    </>
  ),
  seguridad: (
    <>
      <path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z" strokeLinejoin="round" />
    </>
  ),
  ruidos: (
    <>
      <path d="M4 10v4h3l4 4V6l-4 4H4z" strokeLinejoin="round" />
      <path d="M15 9a4 4 0 0 1 0 6M17.5 6.5a8 8 0 0 1 0 11" strokeLinecap="round" />
    </>
  ),
  animales: (
    <>
      <circle cx="8.5" cy="9" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="15.5" cy="9" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="6" cy="14.5" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="18" cy="14.5" r="1.4" fill="currentColor" stroke="none" />
      <path d="M12 11c-2.8 0-4.5 2.2-4.5 4.4 0 1.7 1.3 2.6 2.7 2.6 1 0 1.4-.5 1.8-.5s.8.5 1.8.5c1.4 0 2.7-.9 2.7-2.6C16.5 13.2 14.8 11 12 11z" strokeLinejoin="round" />
    </>
  ),
  "espacio-publico": (
    <>
      <rect x="4" y="4" width="16" height="12" rx="2" />
      <path d="M4 16l4-4 3 3 4-4 5 5" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
};

function GenericPin() {
  return (
    <path
      d="M12 21s-6-5.3-6-10a6 6 0 0 1 12 0c0 4.7-6 10-6 10z"
      strokeLinejoin="round"
    />
  );
}

export function CategoryIcon({
  icon,
  className,
}: {
  icon: string;
  className?: string;
}) {
  const key = icon.toLowerCase().replace(/[_\s]+/g, "-");
  return (
    <svg
      viewBox="0 0 24 24"
      className={clsx("h-5 w-5", className)}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden
    >
      {PATHS[key] ?? <GenericPin />}
    </svg>
  );
}
