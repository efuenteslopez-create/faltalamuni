/**
 * FLM — Indicadores de gestión municipal (spec §7).
 *
 * REGLA DE ORO: todo se calcula desde `statusEvents` (la historia real,
 * append-only). Jamás se usan números editables ni campos materializados.
 * Los indicadores son, por diseño, a prueba de maquillaje.
 */
import { read } from "@/lib/db/store";
import {
  Category,
  DomainError,
  Report,
  ReportState,
  StatusEvent,
} from "@/lib/domain/types";
import { Municipality } from "@/lib/domain/entities";
import { reportMunicipalCredit } from "@/lib/services/common";

export const METHODOLOGY = `Metodología de indicadores — Falta la Muni.

REGLA DE ORO: todo se calcula desde statusEvents (la historia real,
append-only). Jamás se usan números editables ni campos materializados.

Universo: reportes de la comuna, excluyendo los restringidos por moderación
(HIDDEN_BY_MODERATION), que no son públicos.

% con respuesta institucional = (reportes con al menos un evento hacia
ACKNOWLEDGED o un estado posterior / universo) × 100.

Mediana de primera respuesta = mediana, en horas, entre el evento REPORTED y
el primer evento de respuesta institucional (ACKNOWLEDGED o posterior). Los
reportes sin respuesta aún se excluyen del cálculo.

% con gestión registrada = (reportes que alcanzaron IN_PROGRESS o un estado
posterior / universo) × 100.

% con solución informada = (reportes que alcanzaron SOLUTION_PROPOSED o un
estado posterior / universo) × 100.

% verificada = (reportes actualmente en VERIFIED_RESOLVED / universo) × 100.

Reabiertos = reportes con al menos un evento hacia REOPENED.

Derivados = reportes con al menos un evento hacia REFERRED.

Mediana de tiempo de solución = mediana, en horas, entre el evento REPORTED
y el evento que llevó a VERIFIED_RESOLVED, solo para reportes verificados.

Sello "Ya estuvo la Muni" = reportes en VERIFIED_RESOLVED con gestión
municipal acreditada: al menos un evento de estado ejecutado por un actor de
una organización municipal, o la organización gestora del reporte es
municipal. Los reportes verificados sin gestión municipal se cuentan como
"Problema resuelto" (la comunidad lo resolvió sola).

Por categoría: para cada categoría, total de reportes, % con respuesta y
% verificada, con las mismas definiciones anteriores.

Todos los tiempos se calculan sobre eventos con marca temporal real; la
mediana es robusta frente a casos extremos.`;

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const m =
    sorted.length % 2 === 1
      ? sorted[mid]
      : (sorted[mid - 1] + sorted[mid]) / 2;
  return Math.round(m * 10) / 10;
}

function pct(part: number, total: number): number {
  if (total === 0) return 0;
  return Math.round((part / total) * 1000) / 10;
}

const hoursBetween = (a: string, b: string): number =>
  (new Date(b).getTime() - new Date(a).getTime()) / 3_600_000;

/** Estados que implican respuesta institucional (ACKNOWLEDGED en adelante). */
const RESPONDED: ReportState[] = [
  "ACKNOWLEDGED",
  "TRIAGED",
  "ASSIGNED",
  "REFERRED",
  "IN_PROGRESS",
  "SOLUTION_PROPOSED",
  "AWAITING_VERIFICATION",
  "VERIFIED_RESOLVED",
];
const MANAGED: ReportState[] = [
  "IN_PROGRESS",
  "SOLUTION_PROPOSED",
  "AWAITING_VERIFICATION",
  "VERIFIED_RESOLVED",
];
const SOLUTION_INFORMED: ReportState[] = [
  "SOLUTION_PROPOSED",
  "AWAITING_VERIFICATION",
  "VERIFIED_RESOLVED",
];

export interface CategoryMetrics {
  categoryId: string;
  categoryName: string;
  total: number;
  respondedPct: number;
  verifiedPct: number;
}

export interface MunicipalityMetrics {
  municipalityId: string;
  municipalityName: string;
  generatedAt: string;
  /** Reportes considerados (excluye restringidos por moderación). */
  universe: number;
  total: number;
  respondedPct: number;
  medianFirstResponseHours: number | null;
  managementPct: number;
  solutionInformedPct: number;
  verifiedPct: number;
  reopenedCount: number;
  referredCount: number;
  medianSolutionHours: number | null;
  byCategory: CategoryMetrics[];
  /** Sello "Ya estuvo la Muni". */
  municipalSealCount: number;
  /** Verificados sin gestión municipal: "Problema resuelto". */
  resolvedWithoutMunicipalityCount: number;
  methodology: string;
}

interface ReportTimeline {
  report: Report;
  events: StatusEvent[]; // ordenados por createdAt asc
}

function firstTo(events: StatusEvent[], states: ReportState[]): StatusEvent | null {
  return events.find((e) => states.includes(e.to)) ?? null;
}

export async function computeMetrics(
  municipalityId: string
): Promise<MunicipalityMetrics> {
  return read((db) => {
    const municipality = (db.municipalities[municipalityId] as unknown as
      | Municipality
      | undefined) ?? null;
    if (!municipality) {
      throw new DomainError("MUNICIPALITY_NOT_FOUND", "Comuna no encontrada");
    }

    const reports = (Object.values(db.reports) as unknown as Report[]).filter(
      (r) =>
        r.municipalityId === municipalityId &&
        r.state !== "HIDDEN_BY_MODERATION"
    );
    const eventsByReport = new Map<string, StatusEvent[]>();
    for (const e of Object.values(db.statusEvents) as unknown as StatusEvent[]) {
      const list = eventsByReport.get(e.reportId);
      if (list) list.push(e);
      else eventsByReport.set(e.reportId, [e]);
    }
    const timelines: ReportTimeline[] = reports.map((report) => ({
      report,
      events: (eventsByReport.get(report.id) ?? [])
        .slice()
        .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1)),
    }));

    const createdEvent = (t: ReportTimeline): StatusEvent | null =>
      t.events.find((e) => e.to === "REPORTED") ?? t.events[0] ?? null;

    const firstResponseHours: number[] = [];
    const solutionHours: number[] = [];
    let responded = 0;
    let managed = 0;
    let solutionInformed = 0;
    let verified = 0;
    let reopenedCount = 0;
    let referredCount = 0;
    let municipalSealCount = 0;

    for (const t of timelines) {
      const created = createdEvent(t);
      const resp = firstTo(t.events, RESPONDED);
      if (resp) {
        responded += 1;
        if (created) {
          firstResponseHours.push(
            Math.max(0, hoursBetween(created.createdAt, resp.createdAt))
          );
        }
      }
      if (firstTo(t.events, MANAGED)) managed += 1;
      if (firstTo(t.events, SOLUTION_INFORMED)) solutionInformed += 1;
      if (t.report.state === "VERIFIED_RESOLVED") {
        verified += 1;
        const vEvent = [...t.events]
          .reverse()
          .find((e) => e.to === "VERIFIED_RESOLVED");
        if (created && vEvent) {
          solutionHours.push(
            Math.max(0, hoursBetween(created.createdAt, vEvent.createdAt))
          );
        }
        if (reportMunicipalCredit(db, t.report)) municipalSealCount += 1;
      }
      if (firstTo(t.events, ["REOPENED"])) reopenedCount += 1;
      if (firstTo(t.events, ["REFERRED"])) referredCount += 1;
    }

    const categories = Object.values(db.categories) as unknown as Category[];
    const byCategory: CategoryMetrics[] = categories
      .map((c) => {
        const inCat = timelines.filter((t) => t.report.categoryId === c.id);
        const total = inCat.length;
        if (total === 0) return null;
        const resp = inCat.filter((t) => firstTo(t.events, RESPONDED)).length;
        const ver = inCat.filter(
          (t) => t.report.state === "VERIFIED_RESOLVED"
        ).length;
        return {
          categoryId: c.id,
          categoryName: c.name,
          total,
          respondedPct: pct(resp, total),
          verifiedPct: pct(ver, total),
        };
      })
      .filter((x): x is CategoryMetrics => x !== null)
      .sort((a, b) => b.total - a.total);

    const universe = reports.length;
    return {
      municipalityId: municipality.id,
      municipalityName: municipality.name,
      generatedAt: new Date().toISOString(),
      universe,
      total: universe,
      respondedPct: pct(responded, universe),
      medianFirstResponseHours: median(firstResponseHours),
      managementPct: pct(managed, universe),
      solutionInformedPct: pct(solutionInformed, universe),
      verifiedPct: pct(verified, universe),
      reopenedCount,
      referredCount,
      medianSolutionHours: median(solutionHours),
      byCategory,
      municipalSealCount,
      resolvedWithoutMunicipalityCount: verified - municipalSealCount,
      methodology: METHODOLOGY,
    };
  });
}
