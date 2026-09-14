"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { Card, EmptyState, Field, Input, Skeleton } from "@/components/ui/primitives";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { AccessDenied } from "@/components/panel/AccessDenied";
import {
  PANEL_DEPARTMENTS,
  fetchCategories,
  fetchInbox,
  getMe,
  isOverdue,
  isPanelRole,
  timeAgo,
  type Category,
  type Report,
  type ReportState,
  type SessionUser,
} from "../_lib/api";
import { REPORT_STATES, REPORT_STATE_LABELS } from "@/lib/domain/types";

type Tab = "nuevos" | "pendientes" | "vencidos";

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "nuevos", label: "Nuevos" },
  { id: "pendientes", label: "Pendientes de respuesta" },
  { id: "vencidos", label: "Vencidos (>72 h)" },
];

const PENDING_STATES: ReportState[] = [
  "ACKNOWLEDGED",
  "TRIAGED",
  "ASSIGNED",
  "REFERRED",
  "IN_PROGRESS",
  "SOLUTION_PROPOSED",
  "AWAITING_VERIFICATION",
];

const NEW_STATES: ReportState[] = ["REPORTED", "AWAITING_RESPONSE", "REOPENED"];

/**
 * Bandeja institucional: nuevos, pendientes de respuesta y vencidos,
 * con filtros por estado, categoría y departamento.
 */
export default function BandejaPage() {
  const [me, setMe] = useState<SessionUser | null | undefined>(undefined);
  const [reports, setReports] = useState<Report[] | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("nuevos");
  const [stateFilter, setStateFilter] = useState<string>("");
  const [categoryFilter, setCategoryFilter] = useState<string>("");
  const [departmentFilter, setDepartmentFilter] = useState<string>("");
  const [query, setQuery] = useState("");

  useEffect(() => {
    (async () => {
      const user = await getMe();
      setMe(user);
      if (user && isPanelRole(user.role)) {
        setCategories(await fetchCategories());
        await reload({});
      }
    })();
  }, []);

  async function reload(filters: { categoryId?: string; departmentId?: string }) {
    setError(null);
    try {
      setReports(await fetchInbox(filters));
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo cargar la bandeja.");
      setReports([]);
    }
  }

  function applyServerFilters() {
    void reload({
      categoryId: categoryFilter || undefined,
      departmentId: departmentFilter || undefined,
    });
  }

  const counts = useMemo(() => {
    const list = reports ?? [];
    return {
      nuevos: list.filter((r) => !isOverdue(r) && NEW_STATES.includes(r.state)).length,
      pendientes: list.filter((r) => PENDING_STATES.includes(r.state)).length,
      vencidos: list.filter(isOverdue).length,
    };
  }, [reports]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (reports ?? []).filter((r) => {
      if (tab === "nuevos" && !(!isOverdue(r) && NEW_STATES.includes(r.state)))
        return false;
      if (tab === "pendientes" && !PENDING_STATES.includes(r.state)) return false;
      if (tab === "vencidos" && !isOverdue(r)) return false;
      if (stateFilter && r.state !== stateFilter) return false;
      if (
        q &&
        !`${r.code} ${r.title}`.toLowerCase().includes(q)
      )
        return false;
      return true;
    });
  }, [reports, tab, stateFilter, query]);

  if (me === undefined) {
    return (
      <div className="space-y-4" aria-busy="true" aria-label="Cargando bandeja">
        <Skeleton className="h-10 w-1/2" />
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
      </div>
    );
  }

  if (!me || !isPanelRole(me.role)) {
    return <AccessDenied />;
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-extrabold text-flm-ink">Bandeja de entrada</h1>
        <a href="/api/panel/export.csv" className="flm-btn-secondary" download>
          Exportar CSV
        </a>
      </div>

      {/* Pestañas */}
      <div role="tablist" aria-label="Colas de trabajo" className="flex gap-2 overflow-x-auto">
        {TABS.map((t) => {
          const selected = tab === t.id;
          return (
            <button
              key={t.id}
              role="tab"
              aria-selected={selected}
              onClick={() => setTab(t.id)}
              className={clsx(
                "flex min-h-[44px] shrink-0 items-center gap-2 rounded-xl border px-4 py-2 text-sm font-bold",
                selected
                  ? "border-flm-ink bg-flm-ink text-white"
                  : "border-flm-line bg-flm-surface text-flm-ink hover:bg-flm-bg"
              )}
            >
              {t.label}
              <span
                className={clsx(
                  "rounded-full px-2 py-0.5 text-xs tabular-nums",
                  selected ? "bg-white/20" : "bg-flm-line/70"
                )}
                aria-label={`${counts[t.id]} reportes`}
              >
                {counts[t.id]}
              </span>
            </button>
          );
        })}
      </div>

      {/* Filtros */}
      <Card>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Field label="Buscar" htmlFor="q">
            <Input
              id="q"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Código o título…"
            />
          </Field>
          <Field label="Estado" htmlFor="f-state">
            <select
              id="f-state"
              className="flm-input"
              value={stateFilter}
              onChange={(e) => setStateFilter(e.target.value)}
            >
              <option value="">Todos</option>
              {REPORT_STATES.map((s) => (
                <option key={s} value={s}>
                  {REPORT_STATE_LABELS[s]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Categoría" htmlFor="f-cat">
            <select
              id="f-cat"
              className="flm-input"
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
            >
              <option value="">Todas</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Departamento" htmlFor="f-dep">
            <select
              id="f-dep"
              className="flm-input"
              value={departmentFilter}
              onChange={(e) => setDepartmentFilter(e.target.value)}
            >
              <option value="">Todos</option>
              {PANEL_DEPARTMENTS.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </Field>
          <div className="flex items-end">
            <button className="flm-btn-secondary w-full" onClick={applyServerFilters}>
              Aplicar filtros
            </button>
          </div>
        </div>
      </Card>

      {error && (
        <p role="alert" className="text-sm font-medium text-flm-pending">
          {error}
        </p>
      )}

      {/* Lista: cards en móvil, tabla en escritorio */}
      {visible.length === 0 ? (
        <EmptyState
          title="Sin reportes en esta cola"
          description="No hay reportes que coincidan con los filtros. Prueba con otra pestaña o ajusta los filtros."
        />
      ) : (
        <>
          <div className="hidden overflow-x-auto rounded-2xl border border-flm-line bg-flm-surface md:block">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead>
                <tr className="border-b border-flm-line text-xs uppercase tracking-wide text-flm-muted">
                  <th scope="col" className="px-4 py-3">Código</th>
                  <th scope="col" className="px-4 py-3">Reporte</th>
                  <th scope="col" className="px-4 py-3">Estado</th>
                  <th scope="col" className="px-4 py-3">Antigüedad</th>
                  <th scope="col" className="px-4 py-3">Alerta</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => (
                  <tr key={r.id} className="border-b border-flm-line last:border-0 hover:bg-flm-bg">
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-xs font-bold">
                      <Link
                        href={`/panel/reportes/${r.code}`}
                        className="text-flm-institutional underline"
                      >
                        {r.code}
                      </Link>
                    </td>
                    <td className="max-w-[320px] truncate px-4 py-3 font-semibold text-flm-ink">
                      {r.title}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge state={r.state} />
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-flm-muted">
                      {timeAgo(r.createdAt)}
                    </td>
                    <td className="px-4 py-3">
                      {isOverdue(r) ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2.5 py-1 text-xs font-bold text-flm-pending">
                          <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="currentColor" aria-hidden>
                            <path d="M8 1L15 14H1L8 1zm0 4v4m0 2v1.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" fill="none"/>
                          </svg>
                          Vencido
                        </span>
                      ) : (
                        <span className="text-flm-muted">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul className="space-y-3 md:hidden">
            {visible.map((r) => (
              <li key={r.id}>
                <Link
                  href={`/panel/reportes/${r.code}`}
                  className="flm-card block p-4"
                  aria-label={`${r.code}: ${r.title}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-mono text-xs font-bold text-flm-institutional">{r.code}</p>
                    {isOverdue(r) && (
                      <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-bold text-flm-pending">
                        Vencido
                      </span>
                    )}
                  </div>
                  <p className="mt-1 font-bold text-flm-ink">{r.title}</p>
                  <div className="mt-2 flex items-center justify-between">
                    <StatusBadge state={r.state} />
                    <span className="text-xs text-flm-muted">{timeAgo(r.createdAt)}</span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
