import type { Metadata } from "next";
import Link from "next/link";
import { Card } from "@/components/ui/primitives";
import { MetricCard } from "@/components/panel/MetricCard";
import { YaEstuvoLaMuniBadge } from "@/components/ui/StatusBadge";
import type { MunicipalityMetrics } from "@/app/panel/_lib/api";

export const metadata: Metadata = {
  title: "Pudahuel",
  description:
    "Indicadores objetivos de gestión de reportes ciudadanos en la comuna de Pudahuel.",
};

async function getMetrics(): Promise<MunicipalityMetrics | null> {
  try {
    const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
    const res = await fetch(`${base}/api/municipalities/mun-pudahuel/metrics`, {
      next: { revalidate: 300 },
    });
    if (!res.ok) return null;
    const payload = (await res.json()) as unknown;
    const src =
      payload !== null &&
      typeof payload === "object" &&
      "metrics" in payload &&
      payload.metrics !== null &&
      typeof payload.metrics === "object"
        ? (payload.metrics as Record<string, unknown>)
        : (payload as Record<string, unknown>);
    const num = (v: unknown): number =>
      typeof v === "number" && Number.isFinite(v) ? v : 0;
    return {
      total: num(src.total),
      pctResponded: num(src.pctResponded),
      medianFirstResponseHrs: num(src.medianFirstResponseHrs),
      pctManaged: num(src.pctManaged),
      pctSolutionProposed: num(src.pctSolutionProposed),
      pctVerified: num(src.pctVerified),
      reopened: num(src.reopened),
      referred: num(src.referred),
      medianSolutionDays: num(src.medianSolutionDays),
      byCategory: [],
      municipalCreditCount: num(src.municipalCreditCount),
      methodologyUrl:
        typeof src.methodologyUrl === "string" ? src.methodologyUrl : "/metodologia",
    };
  } catch {
    return null;
  }
}

/**
 * Perfil público de la comuna: indicadores objetivos, SIN ranking.
 * Los datos los calcula la plataforma, no la municipalidad.
 */
export default async function ComunaPudahuelPage() {
  const metrics = await getMetrics();

  return (
    <div className="min-h-screen bg-flm-bg">
      <div className="flm-container py-8">
        <Link href="/" className="text-sm font-semibold text-flm-institutional underline">
          ← Volver al inicio
        </Link>
        <h1 className="mt-3 text-3xl font-extrabold text-flm-ink">
          Pudahuel en Falta la Muni
        </h1>
        <p className="mt-2 max-w-2xl text-flm-muted">
          Indicadores objetivos sobre cómo se gestionan los reportes ciudadanos
          en la comuna. Los calcula la plataforma con reglas públicas; la
          municipalidad no puede modificarlos.{" "}
          <Link href="/metodologia" className="underline">
            Ver metodología
          </Link>
          .
        </p>

        {!metrics ? (
          <Card className="mt-6">
            <p className="font-bold text-flm-ink">Indicadores en preparación</p>
            <p className="mt-2 text-flm-muted">
              Los indicadores de Pudahuel aún se están calculando. Vuelve pronto:
              esta página se actualiza automáticamente.
            </p>
          </Card>
        ) : (
          <>
            <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <MetricCard
                label="Reportes ciudadanos"
                value={String(metrics.total)}
                hint="Total publicado en la comuna"
              />
              <MetricCard
                label="Con respuesta institucional"
                value={`${metrics.pctResponded}%`}
                hint="Primera respuesta registrada"
                accent="info"
              />
              <MetricCard
                label="Mediana primera respuesta"
                value={`${metrics.medianFirstResponseHrs} h`}
                hint="Tiempo hasta el reconocimiento"
                accent="info"
              />
              <MetricCard
                label="Solucionados verificados"
                value={`${metrics.pctVerified}%`}
                hint="Verificación ciudadana o independiente"
                accent="ok"
              />
            </div>

            <Card className="mt-6">
              <div className="flex flex-wrap items-center gap-3">
                <YaEstuvoLaMuniBadge />
                <p className="text-sm text-flm-muted">
                  Este sello solo aparece cuando la solución fue verificada por
                  la comunidad o por verificación independiente. Ninguna
                  institución puede auto-otorgárselo.
                </p>
              </div>
            </Card>

            <div className="mt-6 grid gap-4 sm:grid-cols-3">
              <MetricCard
                label="En gestión"
                value={`${metrics.pctManaged}%`}
                hint="Reconocidos, asignados o en terreno"
              />
              <MetricCard
                label="Mediana días a solución"
                value={String(metrics.medianSolutionDays)}
                hint="Del reporte a la solución informada"
              />
              <MetricCard
                label="Derivados a otras instituciones"
                value={String(metrics.referred)}
                hint="SERVIU, MOP, empresas de servicios"
              />
            </div>

            <p className="mt-6 text-sm text-flm-muted">
              Falta la Muni no publica rankings entre comunas: cada comuna se
              mide contra su propio historial y contra metas públicas, no contra
              sus vecinas.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
