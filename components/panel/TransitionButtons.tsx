"use client";

import { useState } from "react";
import {
  allowedTransitions,
  findRule,
} from "@/lib/domain/state-machine";
import { REPORT_STATE_LABELS, type ReportState, type Role } from "@/lib/domain/types";
import { Button, Field, Textarea } from "@/components/ui/primitives";
import {
  ApiError,
  RESPONSIBLE_ORGS,
  postTransition,
  type ReportDetail,
} from "@/app/panel/_lib/api";

/** Etiquetas operacionales para las transiciones institucionales. */
const ACTION_LABELS: Partial<Record<ReportState, string>> = {
  ACKNOWLEDGED: "Reconocer recepción",
  TRIAGED: "Clasificar",
  IN_PROGRESS: "Registrar inicio de gestión",
  SOLUTION_PROPOSED: "Informar solución",
  AWAITING_VERIFICATION: "Solicitar verificación",
};

const ACTION_HINTS: Partial<Record<ReportState, string>> = {
  ACKNOWLEDGED: "Confirma públicamente que el reporte fue recibido por la municipalidad.",
  TRIAGED:
    "Define el responsable directo del problema (municipalidad, SERVIU, MOP, eléctrica, sanitaria, etc.).",
  IN_PROGRESS: "Indica que el departamento o la cuadrilla ya está trabajando en terreno.",
  SOLUTION_PROPOSED:
    "Informa que la solución está lista. Esta acción requiere evidencia fotográfica cargada previamente.",
  AWAITING_VERIFICATION:
    "Pide a la comunidad que verifique la solución en terreno. La verificación final siempre es ciudadana.",
};

/**
 * Botones de transición según `allowedTransitions` y el rol del actor.
 * REFERRED y ASSIGNED se gestionan con sus formularios dedicados
 * (derivación con motivo, asignación a departamento).
 */
export function TransitionButtons({
  report,
  role,
  onChanged,
  onConflict,
}: {
  report: ReportDetail;
  role: Role;
  onChanged: (r: ReportDetail) => void;
  onConflict: () => void;
}) {
  const [active, setActive] = useState<ReportState | null>(null);
  const [reason, setReason] = useState("");
  const [responsibleOrg, setResponsibleOrg] = useState(RESPONSIBLE_ORGS[0].id);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const targets = allowedTransitions(report.state).filter((to) => {
    if (to === "REFERRED" || to === "ASSIGNED") return false; // formularios dedicados
    if (!(to in ACTION_LABELS)) return false;
    const rule = findRule(report.state, to);
    return rule?.allowed.includes(role) ?? false;
  });

  if (targets.length === 0) {
    return (
      <p className="text-sm text-flm-muted">
        No hay acciones de cambio de estado disponibles para este reporte en su
        estado actual ({REPORT_STATE_LABELS[report.state]}).
      </p>
    );
  }

  async function submit(to: ReportState) {
    const rule = findRule(report.state, to);
    setError(null);
    if (rule?.requiresReason && !reason.trim()) {
      setError("Esta acción requiere un fundamento público.");
      return;
    }
    setBusy(true);
    try {
      const finalReason =
        to === "TRIAGED"
          ? `Responsable directo: ${RESPONSIBLE_ORGS.find((o) => o.id === responsibleOrg)?.name ?? responsibleOrg}.${reason.trim() ? ` ${reason.trim()}` : ""}`
          : reason.trim() || undefined;
      const updated = await postTransition(report.code, to, {
        reason: finalReason,
        expectedVersion: report.version,
      });
      setActive(null);
      setReason("");
      onChanged(updated);
    } catch (e) {
      if (e instanceof ApiError && e.isConflict) {
        onConflict();
      } else {
        setError(e instanceof Error ? e.message : "No se pudo completar la acción.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      {targets.map((to) => {
        const rule = findRule(report.state, to);
        const isActive = active === to;
        return (
          <div key={to} className="rounded-xl border border-flm-line p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="font-bold text-flm-ink">{ACTION_LABELS[to]}</p>
                {ACTION_HINTS[to] && (
                  <p className="text-sm text-flm-muted">{ACTION_HINTS[to]}</p>
                )}
              </div>
              <Button
                variant={isActive ? "secondary" : "primary"}
                disabled={busy}
                onClick={() => {
                  setError(null);
                  setActive(isActive ? null : to);
                }}
                aria-expanded={isActive}
              >
                {isActive ? "Cancelar" : ACTION_LABELS[to]}
              </Button>
            </div>
            {isActive && (
              <div className="mt-3 border-t border-flm-line pt-3">
                {to === "TRIAGED" && (
                  <Field label="Responsable directo" htmlFor={`resp-${to}`}>
                    <select
                      id={`resp-${to}`}
                      className="flm-input"
                      value={responsibleOrg}
                      onChange={(e) => setResponsibleOrg(e.target.value)}
                    >
                      {RESPONSIBLE_ORGS.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                )}
                <Field
                  label={
                    rule?.requiresReason
                      ? "Fundamento público (obligatorio)"
                      : "Comentario público (opcional)"
                  }
                  htmlFor={`reason-${to}`}
                  error={error ?? undefined}
                >
                  <Textarea
                    id={`reason-${to}`}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder={
                      to === "TRIAGED"
                        ? "Ej.: Bache en calzada corresponde a mantención municipal; se deriva a Obras."
                        : "Será visible para toda la comunidad."
                    }
                    rows={3}
                  />
                </Field>
                <Button disabled={busy} onClick={() => void submit(to)}>
                  {busy ? "Procesando…" : `Confirmar: ${ACTION_LABELS[to]}`}
                </Button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
