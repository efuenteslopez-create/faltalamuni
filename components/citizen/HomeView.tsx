"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, friendlyErrorMessage, type ReportListItem } from "@/lib/flm/api";
import { REPORT_STATE_GROUPS } from "@/lib/domain/types";
import { CitizenMap, PUDAHUEL_CENTER, type CitizenMapPoint } from "@/components/map/CitizenMap";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { EmptyState, Skeleton } from "@/components/ui/primitives";
import { InstallPrompt } from "@/components/citizen/InstallPrompt";

/**
 * Portada ciudadana: hero con eslogan, mapa destacado, reportes recientes y
 * cifras públicas. Todo se degrada con gracia si la API no responde.
 */
export function HomeView() {
  const [items, setItems] = useState<ReportListItem[] | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .reports({ page: 1 })
      .then((res) => {
        if (cancelled) return;
        setItems(res.items);
        setTotal(res.total);
      })
      .catch((err) => {
        if (!cancelled) setError(friendlyErrorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const points: CitizenMapPoint[] = (items ?? []).map((r) => ({
    code: r.code,
    title: r.title,
    state: r.state,
    lng: r.publicLocation.lng,
    lat: r.publicLocation.lat,
  }));
  const center =
    points.length > 0
      ? { lng: points[0].lng, lat: points[0].lat }
      : PUDAHUEL_CENTER;

  const inProgress = (items ?? []).filter(
    (r) => REPORT_STATE_GROUPS[r.state] === "progress"
  ).length;
  const verified = (items ?? []).filter(
    (r) => REPORT_STATE_GROUPS[r.state] === "verified"
  ).length;

  return (
    <div>
      {/* Hero */}
      <section className="flm-container pt-10 pb-8 text-center sm:pt-16">
        <h1 className="mx-auto max-w-2xl text-3xl font-extrabold tracking-tight text-flm-ink sm:text-5xl">
          Problemas a la vista.{" "}
          <span className="text-flm-accent">Soluciones también.</span>
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-lg text-flm-muted">
          Reporta baches, luminarias apagadas, microbasurales y más. Hazles
          seguimiento en el mapa y verifica cuando la muni los solucione.
        </p>
        <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link href="/reportar" className="flm-btn-primary w-full sm:w-auto">
            Reportar un problema
          </Link>
          <Link href="/mapa" className="flm-btn-secondary w-full sm:w-auto">
            Ver el mapa
          </Link>
        </div>

        {/* Cifras públicas */}
        <dl className="mx-auto mt-10 grid max-w-2xl grid-cols-3 gap-3">
          <div className="flm-card p-4">
            <dt className="text-xs font-semibold uppercase tracking-wide text-flm-muted">Reportes</dt>
            <dd className="mt-1 text-2xl font-extrabold text-flm-ink">
              {total ?? items?.length ?? "—"}
            </dd>
          </div>
          <div className="flm-card p-4">
            <dt className="text-xs font-semibold uppercase tracking-wide text-flm-muted">En gestión</dt>
            <dd className="mt-1 text-2xl font-extrabold text-flm-progress">
              {items ? inProgress : "—"}
            </dd>
          </div>
          <div className="flm-card p-4">
            <dt className="text-xs font-semibold uppercase tracking-wide text-flm-muted">Solucionados</dt>
            <dd className="mt-1 text-2xl font-extrabold text-flm-verified">
              {items ? verified : "—"}
            </dd>
          </div>
        </dl>
      </section>

      {/* Mapa destacado + recientes */}
      <section className="flm-container pb-12">
        <div className="grid gap-6 lg:grid-cols-5">
          <div className="lg:col-span-3">
            <div className="overflow-hidden rounded-2xl border border-flm-line">
              {items === null && !error ? (
                <div className="flm-skeleton h-80" role="status" aria-label="Cargando mapa" />
              ) : (
                <CitizenMap
                  points={points}
                  center={center}
                  zoom={points.length > 0 ? 14 : 12}
                  className="h-80 w-full sm:h-96"
                />
              )}
            </div>
            <p className="mt-2 flex items-center gap-4 text-xs text-flm-muted">
              <span className="inline-flex items-center gap-1.5">
                <span aria-hidden className="h-3 w-3 rounded-full bg-flm-pending" /> Pendientes
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span aria-hidden className="h-3 w-3 rounded-full bg-flm-progress" /> En gestión
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span aria-hidden className="h-3 w-3 rounded-full bg-flm-verified" /> Solucionados
              </span>
            </p>
          </div>

          <div className="lg:col-span-2">
            <div className="flex items-baseline justify-between">
              <h2 className="text-xl font-extrabold text-flm-ink">Recién reportado</h2>
              <Link href="/mapa" className="text-sm font-bold text-flm-accent hover:underline">
                Ver todos →
              </Link>
            </div>
            <div className="mt-3 space-y-3">
              {items === null && !error && (
                <>
                  <Skeleton className="h-24" />
                  <Skeleton className="h-24" />
                  <Skeleton className="h-24" />
                </>
              )}
              {error && (
                <EmptyState
                  title="No pudimos cargar los reportes"
                  description={error}
                  action={
                    <button
                      type="button"
                      onClick={() => window.location.reload()}
                      className="flm-btn-secondary"
                    >
                      Reintentar
                    </button>
                  }
                />
              )}
              {items && items.length === 0 && (
                <EmptyState
                  title="Aún no hay reportes"
                  description="Sé la primera persona en reportar un problema de tu barrio."
                  action={
                    <Link href="/reportar" className="flm-btn-primary">
                      Reportar un problema
                    </Link>
                  }
                />
              )}
              {items?.slice(0, 4).map((r) => (
                <Link
                  key={r.code}
                  href={`/reportes/${encodeURIComponent(r.code)}`}
                  className="flm-card block p-4 transition hover:shadow-pop"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-bold text-flm-ink">{r.title}</p>
                      <p className="mt-1 text-sm text-flm-muted">
                        {r.code} · {r.confirmationsCount}{" "}
                        {r.confirmationsCount === 1 ? "vecino lo confirma" : "vecinos lo confirman"}
                      </p>
                    </div>
                    <StatusBadge state={r.state} />
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Cómo funciona */}
      <section className="border-t border-flm-line bg-flm-surface">
        <div className="flm-container py-12">
          <h2 className="text-center text-2xl font-extrabold text-flm-ink">¿Cómo funciona?</h2>
          <ol className="mx-auto mt-8 grid max-w-3xl gap-4 sm:grid-cols-3">
            {[
              { t: "Reporta", d: "Foto, ubicación y una breve descripción. Toma 2 minutos." },
              { t: "Sigue el avance", d: "Cada cambio de estado queda registrado y visible." },
              { t: "Verifica", d: "Cuando la muni avisa que lo solucionó, los vecinos lo confirman." },
            ].map((s, i) => (
              <li key={s.t} className="flm-card p-5 text-center">
                <span aria-hidden className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-flm-accent/10 text-lg font-extrabold text-flm-accent">
                  {i + 1}
                </span>
                <p className="mt-3 font-bold text-flm-ink">{s.t}</p>
                <p className="mt-1 text-sm text-flm-muted">{s.d}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <InstallPrompt />
    </div>
  );
}
