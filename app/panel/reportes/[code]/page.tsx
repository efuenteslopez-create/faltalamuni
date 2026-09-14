"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import {
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Skeleton,
  Textarea,
} from "@/components/ui/primitives";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { AccessDenied } from "@/components/panel/AccessDenied";
import { TransitionButtons } from "@/components/panel/TransitionButtons";
import { InternalNotes } from "@/components/panel/InternalNotes";
import { REPORT_STATE_LABELS } from "@/lib/domain/types";
import {
  ApiError,
  EXTERNAL_AGENCIES,
  PANEL_DEPARTMENTS,
  fetchReport,
  fetchTimeline,
  formatDateTime,
  getMe,
  isPanelRole,
  postAssignment,
  postEvidence,
  postPublicResponse,
  postReferral,
  timeAgo,
  type ReportDetail,
  type SessionUser,
  type TimelineItem,
} from "../../_lib/api";

type Tab = "gestion" | "notas" | "historial";

/**
 * Detalle operacional: el reporte ciudadano se muestra como SOLO LECTURA.
 * Las acciones institucionales usan expectedVersion; ante conflicto se avisa
 * y se recarga.
 */
export default function ReportDetailPage({
  params,
}: {
  params: { code: string };
}) {
  const code = decodeURIComponent(params.code);
  const [me, setMe] = useState<SessionUser | null | undefined>(undefined);
  const [report, setReport] = useState<ReportDetail | null>(null);
  const [timeline, setTimeline] = useState<TimelineItem[]>([]);
  const [tab, setTab] = useState<Tab>("gestion");
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const [r, t] = await Promise.all([fetchReport(code), fetchTimeline(code)]);
      setReport(r);
      setTimeline(t);
      setConflict(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo cargar el reporte.");
    }
  }, [code]);

  useEffect(() => {
    (async () => {
      const user = await getMe();
      setMe(user);
      if (user && isPanelRole(user.role)) await reload();
    })();
  }, [reload]);

  if (me === undefined) {
    return (
      <div className="space-y-4" aria-busy="true" aria-label="Cargando reporte">
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="h-48" />
      </div>
    );
  }
  if (!me || !isPanelRole(me.role)) return <AccessDenied />;

  if (error && !report) {
    return (
      <EmptyState
        title="No encontramos ese reporte"
        description={`${error} Verifica el código o vuelve a la bandeja.`}
        action={
          <Link href="/panel/bandeja" className="flm-btn-secondary">
            Volver a la bandeja
          </Link>
        }
      />
    );
  }
  if (!report) {
    return (
      <div className="space-y-4" aria-busy="true" aria-label="Cargando reporte">
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="h-48" />
      </div>
    );
  }

  function handleConflict() {
    setConflict(true);
    setNotice(null);
    void reload();
  }

  return (
    <div className="space-y-5">
      <Link
        href="/panel/bandeja"
        className="text-sm font-semibold text-flm-institutional underline"
      >
        ← Volver a la bandeja
      </Link>

      {conflict && (
        <div
          role="alert"
          className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-flm-ink"
        >
          <strong className="font-bold">El reporte cambió mientras trabajabas.</strong>{" "}
          Otro funcionario actualizó este reporte (control de versiones). Se
          recargó la información vigente: revisa el estado actual antes de
          actuar.
        </div>
      )}
      {notice && (
        <div
          role="status"
          className="rounded-xl border border-green-300 bg-green-50 p-4 text-sm text-flm-ink"
        >
          {notice}
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm font-medium text-flm-pending">
          {error}
        </p>
      )}

      {/* Encabezado */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-sm font-bold text-flm-muted">{report.code}</p>
          <h1 className="mt-1 text-2xl font-extrabold text-flm-ink">{report.title}</h1>
          <p className="mt-1 text-sm text-flm-muted">
            {report.categoryName ?? "Categoría"} · Reportado {timeAgo(report.createdAt)} ·
            Actualizado {timeAgo(report.updatedAt)}
          </p>
        </div>
        <StatusBadge state={report.state} />
      </div>

      {/* Reporte ciudadano: SOLO LECTURA */}
      <Card>
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-lg font-bold text-flm-ink">Reporte ciudadano</h2>
          <span className="rounded-full bg-stone-100 px-3 py-1 text-xs font-bold text-flm-muted">
            Solo lectura · no editable
          </span>
        </div>
        <p className="mt-3 whitespace-pre-wrap text-flm-ink">{report.description}</p>
        <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="font-semibold text-flm-muted">Ubicación pública</dt>
            <dd className="text-flm-ink">
              {report.publicLocation
                ? `${report.publicLocation.lat.toFixed(3)}, ${report.publicLocation.lng.toFixed(3)} (aproximada por privacidad)`
                : "No disponible"}
            </dd>
          </div>
          <div>
            <dt className="font-semibold text-flm-muted">Confirmaciones ciudadanas</dt>
            <dd className="text-flm-ink">
              {report.confirmationsCount} · {report.followersCount} seguidores
            </dd>
          </div>
          <div>
            <dt className="font-semibold text-flm-muted">Responsable directo</dt>
            <dd className="text-flm-ink">{report.responsibleOrgId ?? "Sin clasificar"}</dd>
          </div>
          <div>
            <dt className="font-semibold text-flm-muted">Departamento asignado</dt>
            <dd className="text-flm-ink">
              {report.departmentName ?? "Sin asignar"}
              {report.assigneeName ? ` · ${report.assigneeName}` : ""}
            </dd>
          </div>
        </dl>
        <p className="mt-4 rounded-lg bg-flm-bg p-3 text-xs text-flm-muted">
          El texto original del vecino es inmutable: la plataforma no permite
          editarlo, eliminarlo ni moderarlo desde cuentas institucionales.
        </p>
      </Card>

      {/* Pestañas */}
      <div role="tablist" aria-label="Secciones del reporte" className="flex gap-2 overflow-x-auto">
        {(
          [
            { id: "gestion", label: "Gestión" },
            { id: "notas", label: "Notas internas" },
            { id: "historial", label: "Historial" },
          ] as Array<{ id: Tab; label: string }>
        ).map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={clsx(
              "min-h-[44px] shrink-0 rounded-xl border px-4 py-2 text-sm font-bold",
              tab === t.id
                ? "border-flm-ink bg-flm-ink text-white"
                : "border-flm-line bg-flm-surface text-flm-ink hover:bg-flm-bg"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "gestion" && (
        <div className="grid gap-5 lg:grid-cols-2">
          <Card>
            <h2 className="mb-3 text-lg font-bold text-flm-ink">Cambios de estado</h2>
            <TransitionButtons
              report={report}
              role={me.role}
              onChanged={(r) => {
                setReport(r);
                setNotice("Cambio de estado registrado correctamente.");
                void fetchTimeline(code).then(setTimeline).catch(() => undefined);
              }}
              onConflict={handleConflict}
            />
          </Card>
          <div className="space-y-5">
            <Card>
              <h2 className="mb-3 text-lg font-bold text-flm-ink">Asignar a departamento</h2>
              <AssignForm
                reportCode={report.code}
                onDone={() => {
                  setNotice("Asignación registrada.");
                  void reload();
                }}
                onConflict={handleConflict}
              />
            </Card>
            <Card>
              <h2 className="mb-3 text-lg font-bold text-flm-ink">Derivar a agencia externa</h2>
              <ReferForm
                reportCode={report.code}
                onDone={() => {
                  setNotice("Derivación registrada con fundamento.");
                  void reload();
                }}
                onConflict={handleConflict}
              />
            </Card>
            <Card>
              <h2 className="mb-3 text-lg font-bold text-flm-ink">Responder públicamente</h2>
              <RespondForm
                reportCode={report.code}
                onDone={() => {
                  setNotice("Respuesta publicada.");
                  void reload();
                }}
              />
            </Card>
            <Card>
              <h2 className="mb-3 text-lg font-bold text-flm-ink">Subir evidencia</h2>
              <EvidenceForm
                reportCode={report.code}
                onDone={() => {
                  setNotice("Evidencia cargada. Ya puedes informar la solución.");
                  void reload();
                }}
              />
            </Card>
          </div>
        </div>
      )}

      {tab === "notas" && (
        <Card>
          <h2 className="mb-3 text-lg font-bold text-flm-ink">Notas internas</h2>
          <InternalNotes code={report.code} />
        </Card>
      )}

      {tab === "historial" && (
        <Card>
          <h2 className="mb-3 text-lg font-bold text-flm-ink">Historial auditable</h2>
          {timeline.length === 0 ? (
            <p className="text-sm text-flm-muted">
              Aún no hay eventos registrados para este reporte.
            </p>
          ) : (
            <ol className="space-y-4">
              {timeline.map((ev) => (
                <li key={ev.id} className="flex gap-3">
                  <span
                    aria-hidden
                    className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-flm-institutional"
                  />
                  <div className="text-sm">
                    <p className="font-bold text-flm-ink">
                      {ev.from
                        ? `${REPORT_STATE_LABELS[ev.from]} → ${REPORT_STATE_LABELS[ev.to]}`
                        : REPORT_STATE_LABELS[ev.to]}
                    </p>
                    {ev.message && <p className="mt-0.5 text-flm-ink">{ev.message}</p>}
                    {ev.reason && <p className="mt-0.5 text-flm-ink">{ev.reason}</p>}
                    <p className="mt-0.5 text-xs text-flm-muted">
                      {ev.actorName ?? "Sistema"} · {formatDateTime(ev.createdAt)}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </Card>
      )}
    </div>
  );
}

/* ---------- Formularios de gestión ---------- */

function AssignForm({
  reportCode,
  onDone,
  onConflict,
}: {
  reportCode: string;
  onDone: () => void;
  onConflict: () => void;
}) {
  const [departmentId, setDepartmentId] = useState(PANEL_DEPARTMENTS[0].id);
  const [assignee, setAssignee] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await postAssignment(reportCode, departmentId, assignee.trim() || undefined);
      onDone();
    } catch (e) {
      if (e instanceof ApiError && e.isConflict) {
        onConflict();
      } else {
        setError(e instanceof Error ? e.message : "No se pudo asignar.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <Field label="Departamento" htmlFor="assign-dep">
        <select
          id="assign-dep"
          className="flm-input"
          value={departmentId}
          onChange={(e) => setDepartmentId(e.target.value)}
        >
          {PANEL_DEPARTMENTS.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Funcionario/a responsable (opcional)" htmlFor="assign-who">
        <Input
          id="assign-who"
          value={assignee}
          onChange={(e) => setAssignee(e.target.value)}
          placeholder="Nombre de quien toma el caso"
        />
      </Field>
      {error && (
        <p role="alert" className="text-sm font-medium text-flm-pending">
          {error}
        </p>
      )}
      <Button disabled={busy} onClick={() => void submit()}>
        {busy ? "Asignando…" : "Asignar"}
      </Button>
    </div>
  );
}

function ReferForm({
  reportCode,
  onDone,
  onConflict,
}: {
  reportCode: string;
  onDone: () => void;
  onConflict: () => void;
}) {
  const [agencyId, setAgencyId] = useState(EXTERNAL_AGENCIES[0].id);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!reason.trim()) {
      setError("La derivación requiere un motivo fundado.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await postReferral(reportCode, agencyId, reason.trim());
      setReason("");
      onDone();
    } catch (e) {
      if (e instanceof ApiError && e.isConflict) {
        onConflict();
      } else {
        setError(e instanceof Error ? e.message : "No se pudo derivar.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <Field label="Agencia externa" htmlFor="refer-agency">
        <select
          id="refer-agency"
          className="flm-input"
          value={agencyId}
          onChange={(e) => setAgencyId(e.target.value)}
        >
          {EXTERNAL_AGENCIES.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </Field>
      <Field
        label="Motivo de la derivación (obligatorio)"
        htmlFor="refer-reason"
        error={error ?? undefined}
      >
        <Textarea
          id="refer-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Ej.: Postación dañada corresponde a la distribuidora eléctrica; se deriva con fotografías."
          rows={3}
        />
      </Field>
      <Button disabled={busy} onClick={() => void submit()}>
        {busy ? "Derivando…" : "Derivar con fundamento"}
      </Button>
    </div>
  );
}

function RespondForm({
  reportCode,
  onDone,
}: {
  reportCode: string;
  onDone: () => void;
}) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!message.trim()) {
      setError("Escribe un mensaje antes de publicar.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await postPublicResponse(reportCode, message.trim());
      setMessage("");
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo publicar la respuesta.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <Field
        label="Mensaje público"
        htmlFor="respond-msg"
        error={error ?? undefined}
      >
        <Textarea
          id="respond-msg"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Ej.: Vecinas y vecinos: recibimos el reporte y la cuadrilla de aseo pasará este jueves."
          rows={4}
        />
      </Field>
      <p className="text-xs text-flm-muted">
        Se publica con el nombre de la Municipalidad de Pudahuel y queda en el
        historial auditable.
      </p>
      <Button disabled={busy} onClick={() => void submit()}>
        {busy ? "Publicando…" : "Publicar respuesta"}
      </Button>
    </div>
  );
}

function EvidenceForm({
  reportCode,
  onDone,
}: {
  reportCode: string;
  onDone: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setError("Selecciona una foto o documento.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError("El archivo no puede superar 5 MB.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const dataURL = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("No se pudo leer el archivo."));
        reader.readAsDataURL(file);
      });
      await postEvidence(reportCode, dataURL);
      if (fileRef.current) fileRef.current.value = "";
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo subir la evidencia.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <Field label="Foto o documento" htmlFor="evidence-file" error={error ?? undefined}>
        <input
          id="evidence-file"
          ref={fileRef}
          type="file"
          accept="image/*,.pdf"
          className="flm-input py-2.5"
        />
      </Field>
      <p className="text-xs text-flm-muted">
        La evidencia (antes/después) es obligatoria para informar una solución y
        queda en el historial público del reporte.
      </p>
      <Button disabled={busy} onClick={() => void submit()}>
        {busy ? "Subiendo…" : "Subir evidencia"}
      </Button>
    </div>
  );
}
