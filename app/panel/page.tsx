"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, EmptyState, Skeleton } from "@/components/ui/primitives";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { AccessDenied } from "@/components/panel/AccessDenied";
import { MetricCard } from "@/components/panel/MetricCard";
import {
  canExport,
  fetchInbox,
  fetchMetrics,
  getMe,
  isOverdue,
  isPanelRole,
  timeAgo,
  type MunicipalityMetrics,
  type Report,
  type SessionUser,
} from "./_lib/api";

/**
 * Panel institucional — resumen operativo para la Municipalidad de Pudahuel.
 * Accesos a bandeja y analítica + exportación CSV.
 */
export default function PanelDashboard() {
  const [me, setMe] = useState<SessionUser | null | undefined>(undefined);
  const [reports, setReports] = useState<Report[] | null>(null);
  const [metrics, setMetrics] = useState<MunicipalityMetrics | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const user = await getMe();
      setMe(user);
      if (user && isPanelRole(user.role)) {
        try {
          const [inbox, m] = await Promise.all([
            fetchInbox({}),
            fetchMetrics().catch(() => null),
          ]);
          setReports(inbox);
          setMetrics(m);
        } catch (e) {
          setError(
            e instanceof Error ? e.message : "No se pudo cargar la información."
          );
        }
      }
    })();
  }, []);

  if (me === undefined) {
    return (
      <div className="space-y-4" aria-busy="true" aria-label="Cargando panel">
        <Skeleton className="h-10 w-2/3" />
        <div className="grid gap-4 sm:grid-cols-3">
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
        </div>
      </div>
    );
  }

  if (!me || !isPanelRole(me.role)) {
    return <AccessDenied />;
  }

  if (error && reports === null) {
    return (
      <EmptyState
        title="No pudimos cargar la bandeja"
        description={`${error} Es posible que el servicio institucional aún esté en preparación.`}
        action={
          <button
            className="flm-btn-secondary"
            onClick={() => window.location.reload()}
          >
            Reintentar
          </button>
        }
      />
    );
  }

  const list = reports ?? [];
  const overdue = list.filter(isOverdue);
  const fresh = list.filter(
    (r) =>
      !isOverdue(r) &&
      (r.state === "REPORTED" || r.state === "AWAITING_RESPONSE")
  );
  const inProgress = list.filter(
    (r) =>
      r.state === "ACKNOWLEDGED" ||
      r.state === "TRIAGED" ||
      r.state === "ASSIGNED" ||
      r.state === "REFERRED" ||
      r.state === "IN_PROGRESS"
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold text-flm-ink">
          Hola, {me.displayName}
        </h1>
        <p className="mt-1 text-flm-muted">
          Resumen operativo de la comuna de Pudahuel. Los reportes ciudadanos se
          muestran como solo lectura: tu rol gestiona, no edita.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="Nuevos por atender"
          value={String(fresh.length)}
          hint="Reportados y esperando respuesta"
          accent={fresh.length > 0 ? "warn" : "ok"}
        />
        <MetricCard
          label="Vencidos (>72 h sin ACK)"
          value={String(overdue.length)}
          hint="Prioridad: reconocer recepción"
          accent={overdue.length > 0 ? "bad" : "ok"}
        />
        <MetricCard
          label="En gestión"
          value={String(inProgress.length)}
          hint="Reconocidos, asignados o en terreno"
          accent="info"
        />
        <MetricCard
          label="% con respuesta institucional"
          value={metrics ? `${metrics.pctResponded}%` : "—"}
          hint="Indicador objetivo de la comuna"
          accent="ok"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="text-lg font-bold text-flm-ink">Accesos directos</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <Link href="/panel/bandeja" className="flm-btn-primary">
              Abrir bandeja
            </Link>
            <Link href="/panel/analitica" className="flm-btn-secondary">
              Ver analítica
            </Link>
            {canExport(me.role) ? (
              <a href="/api/panel/export.csv" className="flm-btn-secondary" download>
                Exportar CSV
              </a>
            ) : (
              <p className="text-sm text-flm-muted sm:col-span-2">
                La exportación CSV está disponible para el rol de gestión
                municipal.
              </p>
            )}
          </div>
          <p className="mt-4 text-sm text-flm-muted">
            ¿Aún sin cuenta? Usa las credenciales demo:{" "}
            <span className="font-mono">gestora@demo.flm</span> o{" "}
            <span className="font-mono">agente@demo.flm</span> en{" "}
            <Link href="/login" className="underline">
              /login
            </Link>
            .
          </p>
        </Card>

        <Card>
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-flm-ink">
              Requieren atención primero
            </h2>
            <Link href="/panel/bandeja" className="text-sm font-semibold text-flm-institutional underline">
              Ver bandeja
            </Link>
          </div>
          {list.length === 0 ? (
            <p className="mt-3 text-sm text-flm-muted">
              No hay reportes en la cola en este momento.
            </p>
          ) : (
            <ul className="mt-3 divide-y divide-flm-line">
              {[...overdue, ...fresh].slice(0, 5).map((r) => (
                <li key={r.id} className="py-2.5">
                  <Link
                    href={`/panel/reportes/${r.code}`}
                    className="flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-flm-ink">
                        {r.code} · {r.title}
                      </p>
                      <p className="text-xs text-flm-muted">
                        {timeAgo(r.createdAt)}
                        {isOverdue(r) && (
                          <span className="ml-2 font-bold text-flm-pending">
                            Vencido
                          </span>
                        )}
                      </p>
                    </div>
                    <StatusBadge state={r.state} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
