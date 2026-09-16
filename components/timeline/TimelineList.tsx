"use client";

import type {
  MunicipalActionBacking,
  TimelineItem,
} from "@/lib/domain/entities";
import { REPORT_STATE_LABELS } from "@/lib/domain/types";

/**
 * Renderizador compartido del timeline público (iteración 1, "corregir el
 * timeline público real").
 *
 * El endpoint GET /api/reports/[code]/timeline devuelve el arreglo real
 * `TimelineItem[]` (unión discriminada: status | response | evidence |
 * vote | municipal-action). Este componente lo consume directamente, sin
 * transformaciones intermedias, y lo usan tanto la vista ciudadana
 * (components/citizen/ReportDetail) como el timeline institucional
 * (app/panel/reportes/[code]).
 *
 * Garantías de renderizado:
 * - Las referencias URL del respaldo se muestran como enlaces seguros
 *   (solo http/https, target="_blank", rel="noopener noreferrer").
 * - Los documentos/registros muestran su folio o referencia como texto.
 * - Nunca se muestran notas internas (el contrato no las incluye).
 * - Los votos muestran su ronda de verificación para no mezclar
 *   visualmente verificaciones anteriores con la actual.
 */

function formatDate(at: string): string {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return at;
  return d.toLocaleString("es-CL", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function isSafeUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function Backing({ backing }: { backing: MunicipalActionBacking }) {
  const reference = backing.reference?.trim() ?? "";
  return (
    <div className="mt-2 rounded-lg bg-flm-surface px-3 py-2 text-sm ring-1 ring-flm-line">
      <p className="font-bold text-flm-ink">{backing.label}</p>
      {reference.length > 0 &&
        (isSafeUrl(reference) ? (
          <p className="mt-0.5">
            <a
              href={reference}
              target="_blank"
              rel="noopener noreferrer"
              className="break-all font-semibold text-flm-accent underline"
            >
              {reference}
            </a>
          </p>
        ) : (
          <p className="mt-0.5 font-semibold text-flm-ink">{reference}</p>
        ))}
      {backing.summary && (
        <p className="mt-0.5 text-flm-muted">{backing.summary}</p>
      )}
    </div>
  );
}

function itemTitle(item: TimelineItem): string {
  switch (item.type) {
    case "status":
      return item.toLabel;
    case "response":
      return `Respuesta de ${item.organizationName}`;
    case "evidence":
      return item.kind === "solution"
        ? "Evidencia de solución"
        : "Evidencia del problema";
    case "vote":
      return item.approve ? "Aprobó la solución" : "No aprobó la solución";
    case "municipal-action":
      return item.typeLabel;
  }
}

function RoundTag({ item }: { item: Extract<TimelineItem, { type: "vote" }> }) {
  return (
    <span
      className={
        item.currentRound
          ? "rounded-full bg-flm-accent/15 px-2 py-0.5 text-xs font-bold text-flm-accent"
          : "rounded-full bg-flm-line px-2 py-0.5 text-xs font-semibold text-flm-muted"
      }
      title={`Voto de la ronda ${item.roundNumber} de verificación`}
    >
      Ronda {item.roundNumber}
      {item.currentRound ? " · actual" : " · anterior"}
    </span>
  );
}

export function TimelineList({
  items,
  variant,
}: {
  items: TimelineItem[];
  variant: "citizen" | "panel";
}) {
  if (items.length === 0) {
    return (
      <p className="mt-2 text-sm text-flm-muted">
        {variant === "citizen"
          ? "Aún no hay movimientos registrados. Te avisaremos cuando cambie su estado."
          : "Aún no hay eventos registrados para este reporte."}
      </p>
    );
  }
  return (
    <ol className={variant === "citizen" ? "mt-4 space-y-0" : "space-y-4"}>
      {items.map((item, i) => (
        <li
          key={`${item.type}-${item.at}-${i}`}
          className={
            variant === "citizen"
              ? "relative flex gap-3 pb-5 last:pb-0"
              : "flex gap-3"
          }
        >
          <span aria-hidden className="flex flex-col items-center">
            <span
              className={
                variant === "citizen"
                  ? "h-3 w-3 rounded-full bg-flm-accent"
                  : "mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-flm-institutional"
              }
            />
            {variant === "citizen" && i < items.length - 1 && (
              <span className="w-px flex-1 bg-flm-line" />
            )}
          </span>
          <div className={variant === "citizen" ? "pb-1" : "text-sm"}>
            <p
              className={
                variant === "citizen"
                  ? "text-sm font-bold text-flm-ink"
                  : "font-bold text-flm-ink"
              }
            >
              {itemTitle(item)}
              {item.type === "vote" && (
                <>
                  {" · "}
                  {item.voterDisplay} <RoundTag item={item} />
                </>
              )}
            </p>
            {item.type === "status" && (
              <>
                {item.from && (
                  <p className="mt-0.5 text-sm text-flm-muted">
                    Desde: {REPORT_STATE_LABELS[item.from]}
                  </p>
                )}
                {item.reason && (
                  <p className="mt-0.5 text-sm text-flm-muted">{item.reason}</p>
                )}
              </>
            )}
            {item.type === "response" && (
              <p className="mt-0.5 text-sm text-flm-ink">{item.message}</p>
            )}
            {item.type === "evidence" && item.description && (
              <p className="mt-0.5 text-sm text-flm-muted">{item.description}</p>
            )}
            {item.type === "vote" && item.comment && (
              <p className="mt-0.5 text-sm text-flm-muted">{item.comment}</p>
            )}
            {item.type === "municipal-action" && (
              <>
                <p className="mt-0.5 text-sm text-flm-muted">
                  {`${item.organizationName}${item.actorName ? ` · ${item.actorName}` : ""}`}
                </p>
                <p className="mt-1 text-sm text-flm-ink">
                  {item.publicDescription}
                </p>
                <p className="mt-1">
                  {item.accredited ? (
                    <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-bold text-green-800">
                      Respaldo verificado
                    </span>
                  ) : (
                    <span className="rounded-full bg-flm-line px-2 py-0.5 text-xs font-semibold text-flm-muted">
                      Declarada · sin respaldo verificado
                    </span>
                  )}
                </p>
                {item.backing && <Backing backing={item.backing} />}
              </>
            )}
            <p className="mt-0.5 text-xs text-flm-muted">{formatDate(item.at)}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}
