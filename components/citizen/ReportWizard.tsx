"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { z } from "zod";
import { api, friendlyErrorMessage, type ApiCategory } from "@/lib/flm/api";
import {
  clearDraft,
  loadDraft,
  myCodes,
  newDraft,
  saveDraft,
  type ReportDraft,
} from "@/lib/flm/draft";
import { suggestCategory } from "@/lib/flm/suggest";
import { Button, EmptyState, Field, Skeleton, Textarea } from "@/components/ui/primitives";
import { PhotoStep } from "./PhotoStep";
import { LocationStep } from "./LocationStep";
import { DuplicateCheck } from "./DuplicateCheck";
import { ShareButtons } from "./ShareButtons";
import { CategoryIcon } from "./CategoryIcon";

const STEPS = ["Foto", "Ubicación", "Detalle", "Duplicados", "Publicar"] as const;

const publishSchema = z.object({
  categoryId: z.string().min(1, "Elige una categoría para tu reporte."),
  title: z
    .string()
    .trim()
    .min(8, "El título necesita al menos 8 caracteres.")
    .max(120, "El título no puede superar 120 caracteres."),
  description: z
    .string()
    .trim()
    .max(600, "La descripción no puede superar 600 caracteres."),
});

function update<T extends keyof ReportDraft>(
  draft: ReportDraft,
  key: T,
  value: ReportDraft[T]
): ReportDraft {
  return { ...draft, [key]: value };
}

/**
 * Flujo de reporte en pasos con borrador offline.
 * El borrador se guarda en localStorage en cada cambio y la idempotencyKey se
 * genera una sola vez, así reintentar con conexión no duplica el reporte.
 */
export function ReportWizard() {
  const [draft, setDraft] = useState<ReportDraft>(() => loadDraft() ?? newDraft());
  const [step, setStep] = useState(0);
  const [categories, setCategories] = useState<ApiCategory[] | null>(null);
  const [catsError, setCatsError] = useState<string | null>(null);
  const [stepError, setStepError] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [publishedCode, setPublishedCode] = useState<string | null>(null);
  const [online, setOnline] = useState(
    typeof navigator !== "undefined" ? navigator.onLine : true
  );
  const stepHeadingRef = useRef<HTMLHeadingElement>(null);

  const patch = useCallback(
    <T extends keyof ReportDraft>(key: T, value: ReportDraft[T]) =>
      setDraft((d) => update(d, key, value)),
    []
  );

  /* Persistir borrador en cada cambio */
  useEffect(() => {
    if (!publishedCode) saveDraft(draft);
  }, [draft, publishedCode]);

  /* Estado de conexión */
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

  /* Categorías */
  useEffect(() => {
    let cancelled = false;
    api
      .categories()
      .then((c) => {
        if (!cancelled) setCategories(c);
      })
      .catch((err) => {
        if (!cancelled) setCatsError(friendlyErrorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /* Reintentar envío pendiente al recuperar conexión */
  useEffect(() => {
    if (draft.pendingSync && online && !publishing && !publishedCode) {
      void doPublish(draft);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online]);

  useEffect(() => {
    stepHeadingRef.current?.focus();
  }, [step]);

  const categoryById = useMemo(() => {
    const map = new Map<string, ApiCategory>();
    for (const c of categories ?? []) map.set(c.id, c);
    return map;
  }, [categories]);

  const suggestion = useMemo(() => {
    if (!categories) return null;
    const slug = suggestCategory(
      `${draft.title} ${draft.description}`,
      categories.map((c) => c.slug)
    );
    if (!slug || draft.categoryId) return null;
    return categories.find((c) => c.slug === slug) ?? null;
  }, [categories, draft.title, draft.description, draft.categoryId]);

  function validateStep(s: number): string | null {
    if (s === 1 && !draft.location) return "Ubica el problema en el mapa para continuar.";
    if (s === 2) {
      const parsed = publishSchema.safeParse({
        categoryId: draft.categoryId ?? "",
        title: draft.title,
        description: draft.description,
      });
      if (!parsed.success) return parsed.error.issues[0]?.message ?? "Revisa los datos ingresados.";
    }
    return null;
  }

  function next() {
    const err = validateStep(step);
    setStepError(err);
    if (err) return;
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  }

  function back() {
    setStepError(null);
    setStep((s) => Math.max(s - 1, 0));
  }

  async function doPublish(d: ReportDraft) {
    if (!d.location || !d.categoryId) return;
    setPublishing(true);
    setStepError(null);
    try {
      const { code } = await api.createReport({
        categoryId: d.categoryId,
        title: d.title.trim(),
        description: d.description.trim(),
        location: { lng: d.location.lng, lat: d.location.lat },
        anonymousPublic: d.anonymousPublic,
        photoDataUrl: d.photoDataUrl ?? undefined,
        idempotencyKey: d.idempotencyKey,
      });
      myCodes.add(code);
      clearDraft();
      setPublishedCode(code);
    } catch (err) {
      if (err instanceof Error && (err as { status?: number }).status === 0) {
        // Sin red: queda pendiente y se reintenta solo al volver la conexión.
        setDraft((prev) => ({ ...prev, pendingSync: true }));
        setStepError(
          "Sin conexión. Guardamos tu reporte en este dispositivo y lo enviaremos automáticamente cuando vuelva internet."
        );
      } else {
        // La idempotencyKey evita duplicados si el error fue ambiguo.
        setStepError(friendlyErrorMessage(err));
      }
    } finally {
      setPublishing(false);
    }
  }

  async function publish() {
    const err = validateStep(2);
    setStepError(err);
    if (err || !draft.location || !draft.categoryId) return;
    if (!online) {
      setDraft((prev) => ({ ...prev, pendingSync: true }));
      setStepError(
        "Sin conexión. Guardamos tu reporte en este dispositivo y lo enviaremos automáticamente cuando vuelva internet."
      );
      return;
    }
    await doPublish(draft);
  }

  function startNew() {
    setDraft(newDraft());
    setPublishedCode(null);
    setStep(0);
    setStepError(null);
  }

  /* ------------------------------ Éxito ------------------------------ */
  if (publishedCode) {
    return (
      <div className="mx-auto max-w-xl text-center">
        <div className="flm-card p-8">
          <span aria-hidden className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-flm-verified/10 text-flm-verified">
            <svg viewBox="0 0 24 24" className="h-8 w-8" fill="none" stroke="currentColor" strokeWidth="2.4">
              <path d="M4 12.5l5 5L20 6.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <h1 className="mt-4 text-2xl font-extrabold text-flm-ink">¡Reporte publicado!</h1>
          <p className="mt-2 text-flm-muted">
            Guarda este código para hacerle seguimiento:
          </p>
          <p
            className="mt-4 inline-block rounded-2xl bg-flm-bg px-6 py-4 font-mono text-2xl font-bold tracking-wide text-flm-ink sm:text-3xl"
            aria-label={`Código del reporte: ${publishedCode}`}
          >
            {publishedCode}
          </p>
          <div className="mt-6 flex justify-center">
            <ShareButtons code={publishedCode} title={draft.title || "Reporte ciudadano"} />
          </div>
          <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
            <Link href={`/reportes/${encodeURIComponent(publishedCode)}`} className="flm-btn-primary">
              Ver mi reporte
            </Link>
            <Button type="button" variant="secondary" onClick={startNew}>
              Reportar otro problema
            </Button>
          </div>
        </div>
      </div>
    );
  }

  /* --------------------------- Paso actual --------------------------- */
  return (
    <div className="mx-auto max-w-2xl">
      {/* Indicador de progreso */}
      <nav aria-label="Progreso del reporte">
        <ol className="flex items-center gap-1 sm:gap-2">
          {STEPS.map((label, i) => (
            <li key={label} className="flex flex-1 items-center gap-1 sm:gap-2">
              <span
                aria-current={i === step ? "step" : undefined}
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
                  i < step
                    ? "bg-flm-verified text-white"
                    : i === step
                      ? "bg-flm-accent text-white"
                      : "bg-flm-line text-flm-muted"
                }`}
              >
                {i < step ? "✓" : i + 1}
              </span>
              <span
                className={`hidden text-xs font-semibold sm:block ${
                  i === step ? "text-flm-ink" : "text-flm-muted"
                }`}
              >
                {label}
              </span>
              {i < STEPS.length - 1 && <span aria-hidden className="h-px flex-1 bg-flm-line" />}
            </li>
          ))}
        </ol>
      </nav>

      {!online && (
        <p role="status" className="mt-4 rounded-xl bg-amber-50 p-3 text-sm font-medium text-flm-progress">
          Estás sin conexión. Tu avance se guarda en este dispositivo y podrás
          publicar cuando vuelva internet.
        </p>
      )}

      <h1
        ref={stepHeadingRef}
        tabIndex={-1}
        className="mt-6 text-2xl font-extrabold text-flm-ink outline-none"
      >
        {step === 0 && "Toma una foto del problema"}
        {step === 1 && "¿Dónde está el problema?"}
        {step === 2 && "Cuéntanos qué pasa"}
        {step === 3 && "¿Alguien ya lo reportó?"}
        {step === 4 && "Revisa y publica"}
      </h1>

      <div className="flm-card mt-4 p-4 sm:p-6">
        {step === 0 && (
          <PhotoStep value={draft.photoDataUrl} onChange={(v) => patch("photoDataUrl", v)} />
        )}

        {step === 1 && (
          <LocationStep
            value={draft.location}
            onChange={(p) => patch("location", p)}
          />
        )}

        {step === 2 && (
          <div>
            {catsError ? (
              <EmptyState
                title="No pudimos cargar las categorías"
                description={catsError}
                action={
                  <Button type="button" onClick={() => window.location.reload()}>
                    Reintentar
                  </Button>
                }
              />
            ) : categories === null ? (
              <div aria-busy="true" aria-label="Cargando categorías">
                <Skeleton className="h-12" />
                <Skeleton className="mt-2 h-12" />
              </div>
            ) : (
              <>
                <fieldset>
                  <legend className="flm-label">Categoría</legend>
                  {suggestion && (
                    <p className="mb-3 rounded-xl bg-flm-institutional/5 p-3 text-sm text-flm-ink">
                      Por lo que escribiste, parece un problema de{" "}
                      <strong>{suggestion.name}</strong>.{" "}
                      <button
                        type="button"
                        className="font-bold text-flm-institutional underline"
                        onClick={() => patch("categoryId", suggestion.id)}
                      >
                        Usar esta categoría
                      </button>
                    </p>
                  )}
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" role="group" aria-label="Categorías">
                    {categories.map((c) => {
                      const selected = draft.categoryId === c.id;
                      return (
                        <button
                          key={c.id}
                          type="button"
                          aria-pressed={selected}
                          onClick={() => patch("categoryId", selected ? null : c.id)}
                          className={`flex min-h-[56px] items-center gap-2 rounded-xl border px-3 py-2 text-left text-sm font-semibold transition ${
                            selected
                              ? "border-flm-accent bg-flm-accent/5 text-flm-accent"
                              : "border-flm-line bg-white text-flm-ink hover:border-flm-accent/50"
                          }`}
                        >
                          <CategoryIcon icon={c.icon} className="shrink-0" />
                          <span>{c.name}</span>
                        </button>
                      );
                    })}
                  </div>
                </fieldset>

                <div className="mt-5">
                  <Field label="Título" htmlFor="report-title">
                    <input
                      id="report-title"
                      type="text"
                      className="flm-input"
                      placeholder="Ej: Bache grande frente al paradero"
                      maxLength={120}
                      value={draft.title}
                      onChange={(e) => patch("title", e.target.value)}
                      autoComplete="off"
                    />
                  </Field>
                  <Field label="Descripción (opcional)" htmlFor="report-description">
                    <Textarea
                      id="report-description"
                      placeholder="¿Desde cuándo está así? ¿A quiénes afecta? Cualquier detalle ayuda."
                      maxLength={600}
                      value={draft.description}
                      onChange={(e) => patch("description", e.target.value)}
                    />
                  </Field>
                  <label className="flex min-h-[48px] cursor-pointer items-center gap-3 rounded-xl border border-flm-line bg-white px-4">
                    <input
                      type="checkbox"
                      className="h-5 w-5 accent-[#C2410C]"
                      checked={draft.anonymousPublic}
                      onChange={(e) => patch("anonymousPublic", e.target.checked)}
                    />
                    <span className="text-sm font-medium text-flm-ink">
                      Publicar de forma anónima{" "}
                      <span className="font-normal text-flm-muted">
                        (nadie verá tu nombre en el reporte)
                      </span>
                    </span>
                  </label>
                </div>
              </>
            )}
          </div>
        )}

        {step === 3 && draft.location && draft.categoryId && (
          <DuplicateCheck
            lng={draft.location.lng}
            lat={draft.location.lat}
            categoryId={draft.categoryId}
            onDifferentProblem={() => setStep(4)}
          />
        )}

        {step === 4 && (
          <div>
            <dl className="space-y-3 text-sm">
              <div className="flex gap-3">
                <dt className="w-28 shrink-0 font-semibold text-flm-muted">Categoría</dt>
                <dd className="font-medium text-flm-ink">
                  {categoryById.get(draft.categoryId ?? "")?.name ?? "—"}
                </dd>
              </div>
              <div className="flex gap-3">
                <dt className="w-28 shrink-0 font-semibold text-flm-muted">Título</dt>
                <dd className="font-medium text-flm-ink">{draft.title}</dd>
              </div>
              {draft.description.trim() && (
                <div className="flex gap-3">
                  <dt className="w-28 shrink-0 font-semibold text-flm-muted">Detalle</dt>
                  <dd className="text-flm-ink">{draft.description}</dd>
                </div>
              )}
              <div className="flex gap-3">
                <dt className="w-28 shrink-0 font-semibold text-flm-muted">Ubicación</dt>
                <dd className="font-medium text-flm-ink">
                  {draft.location
                    ? `${draft.location.lat.toFixed(5)}, ${draft.location.lng.toFixed(5)}`
                    : "—"}
                </dd>
              </div>
              <div className="flex gap-3">
                <dt className="w-28 shrink-0 font-semibold text-flm-muted">Foto</dt>
                <dd className="font-medium text-flm-ink">
                  {draft.photoDataUrl ? "Incluida" : "Sin foto"}
                </dd>
              </div>
              <div className="flex gap-3">
                <dt className="w-28 shrink-0 font-semibold text-flm-muted">Autoría</dt>
                <dd className="font-medium text-flm-ink">
                  {draft.anonymousPublic ? "Anónimo" : "Con tu nombre"}
                </dd>
              </div>
            </dl>
            <p className="mt-4 rounded-xl bg-flm-bg p-3 text-sm text-flm-muted">
              Al publicar aceptas que tu reporte sea visible públicamente en el
              mapa de la comuna. No incluyas datos personales en la foto ni en
              el texto.
            </p>
          </div>
        )}

        {stepError && (
          <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm font-medium text-flm-pending">
            {stepError}
          </p>
        )}

        {/* Navegación del wizard */}
        <div className="mt-6 flex gap-2">
          {step > 0 && step < 4 && (
            <Button type="button" variant="secondary" onClick={back} className="flex-1">
              Atrás
            </Button>
          )}
          {step < 3 && (
            <Button type="button" onClick={next} className="flex-1">
              Continuar
            </Button>
          )}
          {step === 4 && (
            <>
              <Button type="button" variant="secondary" onClick={back}>
                Atrás
              </Button>
              <Button
                type="button"
                onClick={publish}
                disabled={publishing}
                className="flex-1"
              >
                {publishing
                  ? "Publicando…"
                  : draft.pendingSync
                    ? "Reintentar envío"
                    : "Publicar reporte"}
              </Button>
            </>
          )}
        </div>
      </div>

      <p className="mt-4 text-center text-sm text-flm-muted">
        Tu avance se guarda automáticamente en este dispositivo.
      </p>
    </div>
  );
}
