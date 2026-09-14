"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";

/**
 * Navegación inferior móvil: Inicio, Mapa, Reportar (destacado) y Perfil.
 * Solo visible bajo md; el contenido principal deja espacio con pb en el layout.
 */
const ITEMS = [
  {
    href: "/",
    label: "Inicio",
    icon: (
      <path d="M4 11l8-7 8 7v9a1 1 0 0 1-1 1h-5v-6h-4v6H5a1 1 0 0 1-1-1v-9z" strokeLinejoin="round" />
    ),
  },
  {
    href: "/mapa",
    label: "Mapa",
    icon: (
      <>
        <path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2-6-2z" strokeLinejoin="round" />
        <path d="M9 4v14M15 6v14" strokeLinecap="round" />
      </>
    ),
  },
  {
    href: "/perfil",
    label: "Perfil",
    icon: (
      <>
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21c1.5-4 5-5.5 8-5.5s6.5 1.5 8 5.5" strokeLinecap="round" />
      </>
    ),
  },
];

export function BottomNav() {
  const pathname = usePathname();

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <nav
      aria-label="Navegación principal móvil"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-flm-line bg-flm-surface/95 backdrop-blur md:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="mx-auto grid max-w-md grid-cols-4 px-2">
        {ITEMS.slice(0, 2).map((item) => (
          <BottomNavLink key={item.href} {...item} active={isActive(item.href)} />
        ))}

        {/* CTA destacado: Reportar */}
        <Link
          href="/reportar"
          aria-current={isActive("/reportar") ? "page" : undefined}
          className="flex flex-col items-center justify-center gap-1 py-2"
        >
          <span
            className={clsx(
              "-mt-5 flex h-14 w-14 items-center justify-center rounded-full border-4 border-flm-bg bg-flm-accent text-white shadow-pop",
              isActive("/reportar") && "ring-2 ring-flm-accent/60"
            )}
            aria-hidden
          >
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2.4">
              <path d="M12 5v14M5 12h14" strokeLinecap="round" />
            </svg>
          </span>
          <span
            className={clsx(
              "text-[11px] font-bold",
              isActive("/reportar") ? "text-flm-accent" : "text-flm-ink"
            )}
          >
            Reportar
          </span>
        </Link>

        <BottomNavLink {...ITEMS[2]} active={isActive(ITEMS[2].href)} />
      </div>
    </nav>
  );
}

function BottomNavLink({
  href,
  label,
  icon,
  active,
}: {
  href: string;
  label: string;
  icon: React.ReactNode;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className="flex min-h-[64px] flex-col items-center justify-center gap-1"
    >
      <svg
        viewBox="0 0 24 24"
        className={clsx("h-6 w-6", active ? "text-flm-accent" : "text-flm-muted")}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.9"
        aria-hidden
      >
        {icon}
      </svg>
      <span
        className={clsx(
          "text-[11px] font-bold",
          active ? "text-flm-accent" : "text-flm-muted"
        )}
      >
        {label}
      </span>
    </Link>
  );
}
