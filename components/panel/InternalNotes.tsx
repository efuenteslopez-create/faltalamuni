"use client";

import { useEffect, useState } from "react";
import { Button, Field, Textarea } from "@/components/ui/primitives";
import {
  fetchInternalNotes,
  postInternalNote,
  timeAgo,
  type InternalNote,
} from "@/app/panel/_lib/api";

/**
 * Notas internas: pestaña separada con aviso explícito.
 * Solo visibles para miembros de la organización (el servidor lo garantiza).
 */
export function InternalNotes({ code }: { code: string }) {
  const [notes, setNotes] = useState<InternalNote[] | null>(null);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchInternalNotes(code);
        if (!cancelled) setNotes(data);
      } catch (e) {
        if (!cancelled)
          setError(e instanceof Error ? e.message : "No se pudieron cargar las notas.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code]);

  async function reload() {
    try {
      setNotes(await fetchInternalNotes(code));
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudieron cargar las notas.");
    }
  }

  async function submit() {
    if (!body.trim()) {
      setError("Escribe una nota antes de guardar.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await postInternalNote(code, body.trim());
      setBody("");
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar la nota.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div
        role="note"
        className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-flm-ink"
      >
        <strong className="font-bold">Solo visible para tu organización.</strong>{" "}
        Estas notas nunca se publican ni las ve la ciudadanía. Úsalas para
        coordinar la gestión interna (cuadrillas, turnos, seguimiento).
      </div>

      {error && (
        <p role="alert" className="mb-3 text-sm font-medium text-flm-pending">
          {error}
        </p>
      )}

      {!notes ? (
        <p className="text-sm text-flm-muted">Cargando notas…</p>
      ) : notes.length === 0 ? (
        <p className="text-sm text-flm-muted">
          Aún no hay notas internas para este reporte.
        </p>
      ) : (
        <ul className="space-y-3">
          {notes.map((n) => (
            <li
              key={n.id}
              className="rounded-xl border border-flm-line bg-flm-bg p-3"
            >
              <p className="text-sm text-flm-ink">{n.body}</p>
              <p className="mt-2 text-xs text-flm-muted">
                {n.authorName} · {timeAgo(n.createdAt)}
              </p>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 border-t border-flm-line pt-4">
        <Field label="Nueva nota interna" htmlFor="internal-note">
          <Textarea
            id="internal-note"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Ej.: Cuadrilla de aseo pasa el jueves; coordinar con Obras por el bache."
            rows={3}
          />
        </Field>
        <Button disabled={busy} onClick={() => void submit()}>
          {busy ? "Guardando…" : "Guardar nota interna"}
        </Button>
      </div>
    </div>
  );
}
