"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/lib/flm/auth";

/** Cabecera del sitio: marca + navegación principal + estado de sesión. */
export function SiteHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, loading, logout } = useAuth();

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  async function handleLogout() {
    await logout();
    router.push("/");
    router.refresh();
  }

  return (
    <header className="sticky top-0 z-40 border-b border-flm-line bg-flm-bg/95 backdrop-blur">
      <div className="flm-container flex h-16 items-center justify-between gap-3">
        <Link
          href="/"
          className="flex items-center gap-2.5"
          aria-label="Falta la Muni — inicio"
        >
          <span
            aria-hidden
            className="flex h-9 w-9 items-center justify-center rounded-xl bg-flm-accent text-white"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.2">
              <path d="M12 21s-6-5.3-6-10a6 6 0 0 1 12 0c0 4.7-6 10-6 10z" strokeLinejoin="round" />
              <circle cx="12" cy="11" r="2.2" />
            </svg>
          </span>
          <span className="text-lg font-extrabold tracking-tight text-flm-ink">
            Falta <span className="text-flm-accent">la Muni</span>
          </span>
        </Link>

        <nav aria-label="Navegación principal" className="hidden items-center gap-1 md:flex">
          <Link
            href="/mapa"
            aria-current={isActive("/mapa") ? "page" : undefined}
            className={`rounded-lg px-3 py-2 text-sm font-semibold ${
              isActive("/mapa") ? "text-flm-accent" : "text-flm-ink hover:bg-flm-line/60"
            }`}
          >
            Mapa
          </Link>
          <Link
            href="/reportar"
            aria-current={isActive("/reportar") ? "page" : undefined}
            className={`rounded-lg px-3 py-2 text-sm font-semibold ${
              isActive("/reportar") ? "text-flm-accent" : "text-flm-ink hover:bg-flm-line/60"
            }`}
          >
            Reportar
          </Link>
        </nav>

        <div className="flex items-center gap-2">
          <Link href="/reportar" className="flm-btn-primary hidden !min-h-[44px] !py-2 text-sm md:inline-flex">
            Reportar un problema
          </Link>
          {loading ? (
            <span className="flm-skeleton h-10 w-20 rounded-xl" aria-hidden />
          ) : user ? (
            <div className="flex items-center gap-2">
              <Link
                href="/perfil"
                className="hidden max-w-[10rem] truncate rounded-lg px-2 py-2 text-sm font-semibold text-flm-ink hover:bg-flm-line/60 sm:block"
                title={user.displayName}
              >
                {user.displayName}
              </Link>
              <button
                type="button"
                onClick={handleLogout}
                className="rounded-lg px-3 py-2 text-sm font-semibold text-flm-muted hover:bg-flm-line/60"
              >
                Salir
              </button>
            </div>
          ) : (
            <Link
              href="/login"
              className="rounded-lg px-3 py-2 text-sm font-semibold text-flm-ink hover:bg-flm-line/60"
            >
              Entrar
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
