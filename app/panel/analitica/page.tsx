"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { Card, EmptyState, Skeleton } from "@/components/ui/primitives";
import { YaEstuvoLaMuniBadge } from "@/components/ui/StatusBadge";
import { AccessDenied } from "@/components/panel/AccessDenied";
import { MetricCard } from "@/components/panel/MetricCard";
import type { HeatPoint } from "@/components/panel/Heatmap";
import {
  asArray,
  api,
  fetchMetrics,
  getMe,
  isPanelRole,
  type MunicipalityMetrics,
  type Report,
  type SessionUser,
} from "../_lib/api";

const Heatmap = dynamic(
  () => import("@/components/panel/Heatmap").then((m) => m.Heatmap),
  {
    ssr: false,
    loading: () => <Skeleton className="h-[380px] w-full" />,
  }
);

/** Trae reportes paginados para el mapa operacional (tope de seguridad). */
async function fetchAllReports(): Promise<Report[]> {
  const all: Report[] = [];
  for (let page = 1; page <= 10; page++) {
    const payload = await api<unknown>(`/api/reports?page=${page}`);
    const batch = asArray<Report>(payload);
    if (batch.length === 0) break;
    all.push(...batch);
    if (batch.length < 50) break;
  }
  return all;
}

const COPY_TEMPLATES: Array<{ title: string; body: string }> = [
  {
    title: "Solución verificada",
    body: "Vecinas y vecinos: el reporte fue solucionado y la solución fue verificada por la comunidad. Gracias por reportar y por verificar. #YaEstuvoLaMuni",
  },
  {
    title: "Gestión en curso",
    body: "Estamos trabajando en tu reporte: ya fue clasificado y asignado al departamento correspondiente. Te avisaremos cuando la solución esté lista para verificación. #FaltaLaMuni",
  },
  {
    title: "Derivación a agencia externa",
    body: "Tu reporte corresponde a otra institución responsable (SERVIU, MOP o empresa de servicios). Lo derivamos con todos los antecedentes y haremos seguimiento público. #FaltaLaMuni",
  },
];

function CopyCard({ title, body }: { title: string; body: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(body);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = body;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }
  return (
    <Card className="flex flex-col">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-bold text-flm-ink">{title}</h3>
        <YaEstuvoLaMuniBadge />
      </div>
      <p className="mt-3 flex-1 text-sm text-flm-ink">{body}</p>
      <button
        onClick={() => void copy()}
        className="flm-btn-secondary mt-4"
        aria-live="polite"
      >
        {copied ? "¡Copiado!" : "Copiar texto"}
      </button>
    </Card>
  );
}

/**
 * Analítica institucional: indicadores objetivos, mapa de calor operacional
 * y tarjetas comunicacionales listas para copiar.
 */
export default function AnaliticaPage() {
  const [me, setMe] = useState<SessionUser | null | undefined>(undefined);
  const [metrics, setMetrics] = useState<MunicipalityMetrics | null>(null);
  const [points, setPoints] = useState<HeatPoint[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const user = await getMe();
      setMe(user);
      if (user && isPanelRole(user.role)) {
        try {
          const m = await fetchMetrics();
          setMetrics(m);
        } catch (e) {
          setError(
            e instanceof Error ? e.message : "No se pudieron cargar las métricas."
          );
        }
        try {
          const reports = await fetchAllReports();
          setPoints(
            reports
              .map((r) => r.publicLocation ?? r.location)
              .filter(
                (l): l is { lng: number; lat: number } =>
                  !!l && Number.isFinite(l.lng) && Number.isFinite(l.lat)
              )
              .map((l) => ({ lng: l.lng, lat: l.lat }))
          );
        } catch {
          setPoints([]);
        }
      }
    })();
  }, []);

  const maxCategory = useMemo(
    () =>
      metrics?.byCategory.reduce((a, c) => Math.max(a, c.verified), 0) ?? 0,
    [metrics]
  );

  if (me === undefined) {
    return (
      <div className="space-y-4" aria-busy="true" aria-label="Cargando analítica">
        <Skeleton className="h-10 w-1/2" />
        <div className="grid gap-4 sm:grid-cols-3">
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
        </div>
      </div>
    );
  }
  if (!me || !isPanelRole(me.role)) return <AccessDenied />;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold text-flm-ink">
          Analítica de Pudahuel
        </h1>
        <p className="mt-1 text-flm-muted">
          Indicadores objetivos calculados por la plataforma, no por la
          municipalidad.{" "}
          <a href="/metodologia" className="underline">
            Ver metodología
          </a>
        </p>
      </div>

      {error && (
        <p role="alert" className="text-sm font-medium text-flm-pending">
          {error}
        </p>
      )}

      {!metrics && !error ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-busy="true">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
      ) : metrics ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard
              label="Reportes totales"
              value={String(metrics.total)}
              hint="Acumulado histórico de la comuna"
            />
            <MetricCard
              label="Con respuesta institucional"
              value={`${metrics.pctResponded}%`}
              hint="Reportes con primera respuesta"
              accent="info"
            />
            <MetricCard
              label="Mediana 1ª respuesta"
              value={`${metrics.medianFirstResponseHrs} h`}
              hint="Tiempo hasta el primer ACK"
              accent="info"
            />
            <MetricCard
              label="En gestión"
              value={`${metrics.pctManaged}%`}
              hint="Reconocidos, asignados o en terreno"
            />
            <MetricCard
              label="Solución informada"
              value={`${metrics.pctSolutionProposed}%`}
              hint="La institución informó solución"
              accent="warn"
            />
            <MetricCard
              label="Solucionados verificados"
              value={`${metrics.pctVerified}%`}
              hint="Verificación ciudadana o independiente"
              accent="ok"
            />
            <MetricCard
              label="Mediana días a solución"
              value={`${metrics.medianSolutionDays}`}
              hint="Desde el reporte a la solución informada"
            />
            <MetricCard
              label="Crédito municipal"
              value={String(metrics.municipalCreditCount)}
              hint="Gestiones acreditadas a la municipalidad"
              accent="ok"
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <h2 className="text-lg font-bold text-flm-ink">Reaperturas y derivaciones</h2>
              <dl className="mt-3 space-y-2 text-sm">
                <div className="flex justify-between">
                  <dt className="text-flm-muted">Reportes reabiertos</dt>
                  <dd className="font-bold tabular-nums text-flm-ink">{metrics.reopened}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-flm-muted">Derivados a agencias externas</dt>
                  <dd className="font-bold tabular-nums text-flm-ink">{metrics.referred}</dd>
                </div>
              </dl>
              <p className="mt-3 text-xs text-flm-muted">
                Una reapertura indica que la comunidad consideró insuficiente la
                solución informada.
              </p>
            </Card>
            <Card>
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold text-flm-ink">Por categoría</h2>
                <span className="text-xs text-flm-muted">verificados</span>
              </div>
              {metrics.byCategory.length === 0 ? (
                <p className="mt-3 text-sm text-flm-muted">Sin datos por categoría.</p>
              ) : (
                <ul className="mt-3 space-y-2.5">
                  {metrics.byCategory.map((c) => (
                    <li key={c.slug}>
                      <div className="flex items-center justify-between text-sm">
                        <span className="font-semibold text-flm-ink">{c.name}</span>
                        <span className="tabular-nums text-flm-muted">
                          {c.verified}
                          {typeof c.total === "number" ? ` / ${c.total}` : ""}
                        </span>
                      </div>
                      <div
                        className="mt-1 h-2.5 overflow-hidden rounded-full bg-flm-line/70"
                        role="img"
                        aria-label={`${c.name}: ${c.verified} verificados`}
                      >
                        <div
                          className="h-full rounded-full bg-flm-verified"
                          style={{
                            width: `${maxCategory > 0 ? Math.round((c.verified / maxCategory) * 100) : 0}%`,
                          }}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </>
      ) : (
        <EmptyState
          title="Métricas no disponibles"
          description="El servicio de indicadores aún no responde. Inténtalo más tarde."
        />
      )}

      {/* Mapa de calor operacional */}
      <section aria-labelledby="heatmap-title">
        <h2 id="heatmap-title" className="text-lg font-bold text-flm-ink">
          Mapa de calor operacional
        </h2>
        <p className="mb-3 text-sm text-flm-muted">
          Agregación por celdas de ~300 m con ubicaciones públicas aproximadas.
        </p>
        {points === null ? (
          <Skeleton className="h-[380px] w-full" />
        ) : points.length === 0 ? (
          <EmptyState
            title="Sin datos para el mapa"
            description="Aún no hay reportes georreferenciados para mostrar en el mapa de calor."
          />
        ) : (
          <Heatmap points={points} />
        )}
      </section>

      {/* Tarjetas comunicacionales */}
      <section aria-labelledby="copy-title">
        <h2 id="copy-title" className="text-lg font-bold text-flm-ink">
          Tarjetas comunicacionales
        </h2>
        <p className="mb-3 text-sm text-flm-muted">
          Textos listos para copiar y publicar en los canales municipales. El
          sello “Ya estuvo la Muni” solo corresponde a soluciones verificadas
          por la comunidad.
        </p>
        <div className="grid gap-4 md:grid-cols-3">
          {COPY_TEMPLATES.map((t) => (
            <CopyCard key={t.title} title={t.title} body={t.body} />
          ))}
        </div>
      </section>
    </div>
  );
}
