import type { JSX } from "react";
import clsx from "clsx";
import {
  REPORT_STATE_GROUPS,
  REPORT_STATE_LABELS,
  ReportState,
} from "@/lib/domain/types";

/**
 * Badge de estado: color + icono + texto (nunca solo color, WCAG AA).
 * Iconos inline SVG simples.
 */
const ICONS: Record<string, JSX.Element> = {
  pending: (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="currentColor" aria-hidden>
      <circle cx="8" cy="8" r="6" fillOpacity="0.25" />
      <circle cx="8" cy="8" r="2.5" />
    </svg>
  ),
  progress: (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M8 2v6l4 2" strokeLinecap="round" />
      <circle cx="8" cy="8" r="6.5" />
    </svg>
  ),
  verified: (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <circle cx="8" cy="8" r="6.5" />
      <path d="M5.5 8.5l2 2 3.5-4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  neutral: (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="currentColor" aria-hidden>
      <rect x="3" y="3" width="10" height="10" rx="2" fillOpacity="0.25" />
      <rect x="6" y="6" width="4" height="4" rx="1" />
    </svg>
  ),
};

const STYLES: Record<string, string> = {
  pending: "bg-red-50 text-flm-pending border-red-200",
  progress: "bg-amber-50 text-flm-progress border-amber-200",
  verified: "bg-green-50 text-flm-verified border-green-200",
  neutral: "bg-stone-100 text-flm-muted border-stone-200",
};

export function StatusBadge({ state, className }: { state: ReportState; className?: string }) {
  const group = REPORT_STATE_GROUPS[state];
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-bold",
        STYLES[group],
        className
      )}
    >
      {ICONS[group]}
      {REPORT_STATE_LABELS[state]}
    </span>
  );
}

/** Sello "Ya estuvo la Muni" — solo para VERIFIED_RESOLVED con gestión municipal acreditada. */
export function YaEstuvoLaMuniBadge({ className }: { className?: string }) {
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1.5 rounded-full bg-flm-verified px-3 py-1.5 text-sm font-bold text-white",
        className
      )}
    >
      <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden>
        <path d="M3 8.5l3.5 3.5L13 4.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      Ya estuvo la Muni
    </span>
  );
}
