"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, type ReportDetail } from "@/lib/flm/api";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Button, EmptyState, Skeleton } from "@/components/ui/primitives";
import { confirmedCodes, followedCodes, myCodes } from "@/lib/flm/draft";
import { useAuth } from "@/lib/flm/auth";

const ROLE_LABELS: Record<string, string> = {
  RESIDENT: "Vecino/a",
  VERIFIED_RESIDENT: "Vecino/a verificado/a",
  MUNICIPAL_AGENT: "Agente municipal",
  MUNICIPAL_MANAGER: "Gestión municipal",
  EXTERNAL_AGENCY_AGENT: "Agencia externa",
  INDEPENDENT_MODERATOR: "Moderación independiente",
  PLATFORM_ADMIN: "Administración",
};

interface Section {
  title: string;
  description: string;
  codes: string[];
  emptyAction: string;
}

/** Mi perfil: mis reportes, confirmaciones y seguidos. Requiere sesión. */
export function ProfileView() {
  const router = useRouter();
  const { user, loading, logout } = useAuth();
  const [details, setDetails] = useState<Record<string, ReportDetail>>({});
  const [failed, setFailed] = useState<string[]>([]);
  const [loadingReports, setLoadingReports] = useState(true);

  // Al cambiar de usuario se vuelve a "cargando" durante el render (patrón
  // documentado de React): evita setState sincrónico dentro del efecto.
  const activeUserId = user?.id ?? null;
  const [lastUserId, setLastUserId] = useState<string | null>(activeUserId);
  if (lastUserId !== activeUserId) {
    setLastUserId(activeUserId);
    setLoadingReports(true);
  }

  useEffect(() => {
    if (!loading && !user) {
      router.replace(`/login?next=${encodeURIComponent("/perfil")}`);
    }
  }, [loading, user, router]);

  useEffect(() => {
    if (!user) return;
    const seen = new Set<string>();
    const codes: string[] = [];
    for (const c of [...myCodes.list(), ...confirmedCodes.list(), ...followedCodes.list()]) {
      if (!seen.has(c)) {
        seen.add(c);
        codes.push(c);
      }
    }
    let cancelled = false;
    // Promise.allSettled([]) se resuelve de forma asíncrona con []: el caso
    // "sin reportes" queda cubierto por la misma continuación, sin setState
    // sincrónico dentro del efecto.
    Promise.allSettled(codes.map((c) => api.report(c))).then((results) => {
      if (cancelled) return;
      const ok: Record<string, ReportDetail> = {};
      const bad: string[] = [];
      results.forEach((r, i) => {
        if (r.status === "fulfilled") ok[codes[i]] = r.value;
        else bad.push(codes[i]);
      });
      setDetails(ok);
      setFailed(bad);
      setLoadingReports(false);
    });
    return () => {
      cancelled = true;
    };
  }, [user]);

  async function handleLogout() {
    await logout();
    router.push("/");
    router.refresh();
  }

  if (loading) {
    return (
      <div className="flm-container py-6" aria-busy="true" aria-label="Cargando perfil">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="mt-4 h-24" />
      </div>
    );
  }
  if (!user) return null;

  const sections: Section[] = [
    {
      title: "Mis reportes",
      description: "Reportes que creaste desde este dispositivo.",
      codes: myCodes.list(),
      emptyAction: "/reportar",
    },
    {
      title: "Confirmé que también los vi",
      description: "Problemas de otros vecinos que confirmaste.",
      codes: confirmedCodes.list(),
      emptyAction: "/mapa",
    },
    {
      title: "Estoy siguiendo",
      description: "Te avisaremos cuando cambien de estado.",
      codes: followedCodes.list(),
      emptyAction: "/mapa",
    },
  ];

  return (
    <div className="flm-container py-6">
      <div className="flm-card flex flex-wrap items-center justify-between gap-4 p-5">
        <div>
          <h1 className="text-2xl font-extrabold text-flm-ink">{user.displayName}</h1>
          <p className="mt-1 text-sm text-flm-muted">
            {user.email} · {ROLE_LABELS[user.role] ?? user.role}
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/reportar" className="flm-btn-primary">
            Reportar un problema
          </Link>
          <Button type="button" variant="secondary" onClick={handleLogout}>
            Cerrar sesión
          </Button>
        </div>
      </div>

      {failed.length > 0 && (
        <p role="status" className="mt-4 rounded-xl bg-amber-50 p-3 text-sm text-flm-progress">
          No pudimos cargar {failed.length} {failed.length === 1 ? "reporte" : "reportes"}. Revisa tu
          conexión e inténtalo de nuevo más tarde.
        </p>
      )}

      <div className="mt-8 space-y-8">
        {sections.map((s) => (
          <section key={s.title} aria-label={s.title}>
            <h2 className="text-xl font-extrabold text-flm-ink">{s.title}</h2>
            <p className="mt-0.5 text-sm text-flm-muted">{s.description}</p>
            {loadingReports ? (
              <div className="mt-3 space-y-3" aria-busy="true" aria-label={`Cargando ${s.title}`}>
                <Skeleton className="h-24" />
              </div>
            ) : s.codes.length === 0 ? (
              <EmptyState
                title="Nada por aquí todavía"
                description={
                  s.title === "Mis reportes"
                    ? "Cuando publiques tu primer reporte, aparecerá aquí."
                    : "Explora el mapa y participa en los reportes de tu barrio."
                }
                action={
                  <Link href={s.emptyAction} className="flm-btn-secondary">
                    {s.title === "Mis reportes" ? "Crear mi primer reporte" : "Ir al mapa"}
                  </Link>
                }
              />
            ) : (
              <ul className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {s.codes.map((code) => {
                  const r = details[code];
                  if (!r) return null;
                  return (
                    <li key={code}>
                      <Link
                        href={`/reportes/${encodeURIComponent(code)}`}
                        className="flm-card block h-full p-4 transition hover:shadow-pop"
                      >
                        <p className="font-bold text-flm-ink">{r.title}</p>
                        <p className="mt-1 text-sm text-flm-muted">{r.code}</p>
                        <div className="mt-2">
                          <StatusBadge state={r.state} />
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}
