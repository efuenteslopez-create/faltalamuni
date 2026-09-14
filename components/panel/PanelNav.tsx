"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";

const LINKS = [
  { href: "/panel", label: "Resumen" },
  { href: "/panel/bandeja", label: "Bandeja" },
  { href: "/panel/analitica", label: "Analítica" },
];

/** Navegación del panel con estado activo (no solo color: subrayado + aria-current). */
export function PanelNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Panel institucional" className="flex items-center gap-1">
      {LINKS.map((l) => {
        const active =
          l.href === "/panel" ? pathname === "/panel" : pathname.startsWith(l.href);
        return (
          <Link
            key={l.href}
            href={l.href}
            aria-current={active ? "page" : undefined}
            className={clsx(
              "rounded-lg px-3 py-2 text-sm font-semibold transition",
              active
                ? "bg-flm-ink text-white underline underline-offset-4"
                : "text-flm-ink hover:bg-flm-line/60"
            )}
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
