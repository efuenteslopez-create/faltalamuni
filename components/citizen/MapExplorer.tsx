"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { api, friendlyErrorMessage, type ApiCategory, type ReportListItem } from "@/lib/flm/api";
import { REPORT_STATE_GROUPS } from "@/lib/domain/types";
import { CitizenMap, PUDAHUEL_CENTER, type CitizenMapPoint } from "@/components/map/CitizenMap";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { EmptyState, Skeleton } from "@/components/ui/primitives";
import { CategoryIcon } from "@/components/citizen/CategoryIcon";

type Tab = "mapa" | "lista";
const GROUP_FILTERS = ["all", "pending", "progress", "verified"] as const;
type GroupFilter = (typeof GROUP_FILTERS)[number];

const GROUP_LABELS: Record<(typeof GROUP_FILTERS)[number], string> = {
  all: "Todos",
  pending: "Pendientes",
  progress: "En gestión",
  verified: "Solucionados",
};

/** Explorador público: tabs Mapa/Lista, filtros por estado y categoría, clustering. */
export function MapExplorer() {
  const [tab, setTab] = useState<Tab>("mapa");
  const [group, setGroup] = useState<GroupFilter>("all");
  const [categoryId, setCategoryId] = useState<string>("all");
  const [categories, setCategories] = useState<ApiCategory[]>([]);
  const [items, setItems] = useState<ReportListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [online, setOnline] = useState(
    typeof navigator !== "undefined" ? navigator.onLine : true
  );

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  useEffect(() => {
    api.categories().then(setCategories).catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    setItems(null);
    setError(null);
    api
      .reports({ categoryId: categoryId === "all" ? undefined : categoryId, page: 1 })
      .then((res) => {
        if (!cancelled) setItems(res.items);
      })
      .catch((err) => {
        if (!cancelled) setError(friendlyErrorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [categoryId]);

  const filtered = useMemo(() => {
    if (!items) return null;
    if (group === "all") return items;
    return items.filter((r) => REPORT_STATE_GROUPS[r.state] === group);
  }, [items, group]);

  const points: CitizenMapPoint[] = useMemo(
    () =>
      (filtered ?? []).map((r) => ({
        code: r.code,
        title: r.title,
        state: r.state,
        lng: r.publicLocation.lng,
        lat: r.publicLocation.lat,
      })),
    [filtered]
  );

  const center =
    points.length > 0 ? { lng: points[0].lng, lat: points[0].lat } : PUDAHUEL_CENTER;

  function onTabKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      setTab((t) => (t === "mapa" ? "lista" : "mapa"));
    }
  }

  return (
    <div className="flm-container py-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold text-flm-ink sm:text-3xl">Mapa de reportes</h1>
          <p className="mt-1 text-flm-muted">
            Todos los problemas reportados por vecinos, en un solo lugar.
          </p>
        </div>
        {/* Tabs Mapa / Lista */}
        <div
          role="tablist"
          aria-label="Vista del explorador"
          onKeyDown={onTabKeyDown}
          className="flex rounded-xl border border-flm-line bg-flm-surface p-1"
        >
          {(["mapa", "lista"] as Tab[]).map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className={clsx(
                "min-h-[44px] rounded-lg px-5 text-sm font-bold transition",
                tab === t ? "bg-flm-ink text-white" : "text-flm-muted hover:text-flm-ink"
              )}
            >
              {t === "mapa" ? "Mapa" : "Lista"}
            </button>
          ))}
        </div>
      </div>

      {/* Filtros */}
      <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Filtrar por estado">
        {GROUP_FILTERS.map((g) => (
          <button
            key={g}
            type="button"
            aria-pressed={group === g}
            onClick={() => setGroup(g)}
            className={clsx(
              "min-h-[44px] rounded-full border px-4 text-sm font-bold transition",
              group === g
                ? "border-flm-accent bg-flm-accent text-white"
                : "border-flm-line bg-flm-surface text-flm-ink hover:border-flm-accent/50"
            )}
          >
            {GROUP_LABELS[g]}
          </button>
        ))}
      </div>
      {categories.length > 0 && (
        <div className="mt-2 flex gap-2 overflow-x-auto pb-1" role="group" aria-label="Filtrar por categoría">
          <button
            type="button"
            aria-pressed={categoryId === "all"}
            onClick={() => setCategoryId("all")}
            className={clsx(
              "flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-full border px-4 text-sm font-bold",
              categoryId === "all"
                ? "border-flm-ink bg-flm-ink text-white"
                : "border-flm-line bg-flm-surface text-flm-ink"
            )}
          >
            Todas
          </button>
          {categories.map((c) => (
            <button
              key={c.id}
              type="button"
              aria-pressed={categoryId === c.id}
              onClick={() => setCategoryId(categoryId === c.id ? "all" : c.id)}
              className={clsx(
                "flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-full border px-4 text-sm font-bold",
                categoryId === c.id
                  ? "border-flm-ink bg-flm-ink text-white"
                  : "border-flm-line bg-flm-surface text-flm-ink"
              )}
            >
              <CategoryIcon icon={c.icon} className="h-4 w-4" />
              {c.name}
            </button>
          ))}
        </div>
      )}

      {!online && (
        <p role="status" className="mt-3 rounded-xl bg-amber-50 p-3 text-sm font-medium text-flm-progress">
          Estás sin conexión: se muestran los últimos datos cargados.
        </p>
      )}

      <div className="mt-4">
        {items === null && !error && (
          <div aria-busy="true" aria-label="Cargando reportes">
            {tab === "mapa" ? <Skeleton className="h-[60vh]" /> : (<><Skeleton className="h-24" /><Skeleton className="mt-3 h-24" /></>)}
          </div>
        )}

        {error && (
          <EmptyState
            title="No pudimos cargar el mapa"
            description={error}
            action={
              <button type="button" onClick={() => window.location.reload()} className="flm-btn-secondary">
                Reintentar
              </button>
            }
          />
        )}

        {filtered && filtered.length === 0 && !error && (
          <EmptyState
            title="No hay reportes con esos filtros"
            description="Prueba con otra categoría o estado, o sé la primera persona en reportar."
            action={
              <Link href="/reportar" className="flm-btn-primary">
                Reportar un problema
              </Link>
            }
          />
        )}

        {filtered && filtered.length > 0 && tab === "mapa" && (
          <div className="overflow-hidden rounded-2xl border border-flm-line">
            <CitizenMap
              points={points}
              center={center}
              zoom={points.length > 0 ? 14 : 12}
              cluster
              className="h-[60vh] w-full"
            />
          </div>
        )}

        {filtered && filtered.length > 0 && tab === "lista" && (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((r) => (
              <li key={r.code}>
                <Link
                  href={`/reportes/${encodeURIComponent(r.code)}`}
                  className="flm-card block h-full p-4 transition hover:shadow-pop"
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-bold text-flm-ink">{r.title}</p>
                  </div>
                  <p className="mt-1 text-sm text-flm-muted">
                    {r.code} · {r.confirmationsCount}{" "}
                    {r.confirmationsCount === 1 ? "confirmación" : "confirmaciones"}
                  </p>
                  <div className="mt-2">
                    <StatusBadge state={r.state} />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      {filtered && filtered.length > 0 && (
        <p className="mt-3 text-sm text-flm-muted" aria-live="polite">
          Mostrando {filtered.length} {filtered.length === 1 ? "reporte" : "reportes"}.
        </p>
      )}
    </div>
  );
}
