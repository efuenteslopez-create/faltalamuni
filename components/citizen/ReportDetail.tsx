"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, friendlyErrorMessage, type ReportDetail as Detail, type TimelineItem } from "@/lib/flm/api";
import { StatusBadge, YaEstuvoLaMuniBadge } from "@/components/ui/StatusBadge";
import { TimelineList } from "@/components/timeline/TimelineList";
import { Button, EmptyState, Skeleton } from "@/components/ui/primitives";
import { ShareButtons } from "@/components/citizen/ShareButtons";
import { CitizenMap } from "@/components/map/CitizenMap";
import { confirmedCodes, followedCodes } from "@/lib/flm/draft";
import { useAuth } from "@/lib/flm/auth";

/** Detalle público de un reporte: foto, estado, cronología, acciones ciudadanas. */
export function ReportDetail({ code }: { code: string }) {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [report, setReport] = useState<Detail | null>(null);
  const [events, setEvents] = useState<TimelineItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [following, setFollowing] = useState(false);
  const [isFollowing, setIsFollowing] = useState(false);
  const [hasConfirmed, setHasConfirmed] = useState(false);
  const [vote, setVote] = useState<"approve" | "reject" | null>(null);
  const [comment, setComment] = useState("");
  const [voting, setVoting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [detail, timeline] = await Promise.all([
        api.report(code),
        api.timeline(code).catch(() => null),
      ]);
      setReport(detail);
      // El contrato del timeline es el arreglo real TimelineItem[]
      // (unión discriminada) que devuelve el endpoint.
      setEvents(timeline ?? []);
      setIsFollowing(followedCodes.has(code));
      setHasConfirmed(confirmedCodes.has(code));
    } catch (err) {
      setError(friendlyErrorMessage(err));
    }
  }, [code]);

  useEffect(() => {
    void load();
  }, [load]);

  function requireLogin() {
    router.push(`/login?next=${encodeURIComponent(`/reportes/${code}`)}`);
  }

  async function handleConfirm() {
    if (!user) return requireLogin();
    setConfirming(true);
    setNotice(null);
    try {
      await api.confirm(code);
      confirmedCodes.add(code);
      setHasConfirmed(true);
      setReport((r) =>
        r ? { ...r, confirmationsCount: r.confirmationsCount + 1 } : r
      );
      setNotice("¡Gracias! Tu confirmación le da más fuerza a este reporte.");
    } catch (err) {
      setNotice(friendlyErrorMessage(err));
    } finally {
      setConfirming(false);
    }
  }

  async function handleFollow() {
    if (!user) return requireLogin();
    setFollowing(true);
    try {
      if (isFollowing) {
        await api.unfollow(code);
        followedCodes.remove(code);
        setIsFollowing(false);
      } else {
        await api.follow(code);
        followedCodes.add(code);
        setIsFollowing(true);
      }
    } catch (err) {
      setNotice(friendlyErrorMessage(err));
    } finally {
      setFollowing(false);
    }
  }

  async function handleVote(approve: boolean) {
    if (!user) return requireLogin();
    setVoting(true);
    setNotice(null);
    try {
      await api.verificationVote(code, {
        approve,
        comment: comment.trim() || undefined,
      });
      setVote(approve ? "approve" : "reject");
      setNotice(
        approve
          ? "Registramos que la solución te parece correcta. ¡Gracias por verificar!"
          : "Registramos tu observación. Un moderador la revisará."
      );
    } catch (err) {
      setNotice(friendlyErrorMessage(err));
    } finally {
      setVoting(false);
    }
  }

  if (error) {
    return (
      <div className="flm-container py-10">
        <EmptyState
          title="No pudimos cargar este reporte"
          description={error}
          action={
            <div className="flex gap-2">
              <Button type="button" onClick={() => void load()}>Reintentar</Button>
              <Link href="/mapa" className="flm-btn-secondary">Volver al mapa</Link>
            </div>
          }
        />
      </div>
    );
  }

  if (!report) {
    return (
      <div className="flm-container py-6" aria-busy="true" aria-label="Cargando reporte">
        <Skeleton className="h-64" />
        <Skeleton className="mt-4 h-8 w-2/3" />
        <Skeleton className="mt-2 h-24" />
      </div>
    );
  }

  const showYaEstuvo = report.state === "VERIFIED_RESOLVED" && report.municipalCredit;
  const inVerification = report.state === "AWAITING_VERIFICATION";

  return (
    <div className="flm-container py-6">
      <Link href="/mapa" className="text-sm font-bold text-flm-accent hover:underline">
        ← Volver al mapa
      </Link>

      <div className="mt-3 grid gap-6 lg:grid-cols-5">
        {/* Columna principal */}
        <div className="lg:col-span-3">
          <div className="flm-card overflow-hidden">
            {report.photoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={report.photoUrl}
                alt={`Foto del reporte: ${report.title}`}
                className="max-h-96 w-full object-cover"
              />
            ) : (
              <div className="flex h-48 items-center justify-center bg-flm-bg text-flm-muted">
                <p className="text-sm font-medium">Este reporte no incluye foto</p>
              </div>
            )}
            <div className="p-4 sm:p-6">
              <div className="flex flex-wrap items-center gap-2">
                {showYaEstuvo ? (
                  <YaEstuvoLaMuniBadge />
                ) : (
                  <StatusBadge state={report.state} />
                )}
                {report.municipalCredit && !showYaEstuvo && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-flm-institutional/10 px-2.5 py-1 text-xs font-bold text-flm-institutional">
                    Gestión municipal acreditada
                  </span>
                )}
              </div>

              <h1 className="mt-3 text-2xl font-extrabold text-flm-ink sm:text-3xl">
                {report.title}
              </h1>
              <p className="mt-1 text-sm text-flm-muted">
                {report.code} · Reportado el{" "}
                {new Date(report.createdAt).toLocaleDateString("es-CL", {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                })}
                {!report.anonymousPublic && report.authorDisplayName && (
                  <> por {report.authorDisplayName}</>
                )}
              </p>

              {report.description && (
                <p className="mt-4 whitespace-pre-line text-flm-ink">{report.description}</p>
              )}

              {/* Atribución: responsable, gestor, ejecutor, verificación y crédito */}
              {report.state === "VERIFIED_RESOLVED" && report.attribution && (
                <section aria-label="Atribución de la solución" className="mt-6 rounded-2xl border border-flm-line p-4">
                  <h2 className="text-lg font-extrabold text-flm-ink">Atribución</h2>
                  <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
                    <div>
                      <dt className="font-bold text-flm-muted">Responsable</dt>
                      <dd className="mt-0.5 font-medium text-flm-ink">
                        {report.attribution.responsible?.name ?? "Por determinar"}
                      </dd>
                    </div>
                    <div>
                      <dt className="font-bold text-flm-muted">Gestor</dt>
                      <dd className="mt-0.5 font-medium text-flm-ink">
                        {report.attribution.managing?.name ?? "—"}
                      </dd>
                    </div>
                    <div>
                      <dt className="font-bold text-flm-muted">Ejecutor</dt>
                      <dd className="mt-0.5 font-medium text-flm-ink">
                        {report.attribution.executor?.name ?? "—"}
                      </dd>
                    </div>
                    <div>
                      <dt className="font-bold text-flm-muted">Verificación</dt>
                      <dd className="mt-0.5 font-medium text-flm-ink">
                        {report.attribution.verification
                          ? `Ciudadanía (${report.attribution.verification.approvers} ${
                              report.attribution.verification.approvers === 1 ? "aprobación" : "aprobaciones"
                            })`
                          : "Ciudadanía"}
                      </dd>
                    </div>
                  </dl>
                  {report.attribution.municipalCredit.explanation && (
                    <p className="mt-3 border-t border-flm-line pt-3 text-sm font-medium text-flm-ink">
                      {report.attribution.municipalCredit.explanation}
                    </p>
                  )}
                </section>
              )}

              {/* Comparación antes / después */}
              {report.evidenceUrls.length > 0 && (
                <section aria-label="Evidencia de la solución" className="mt-6">
                  <h2 className="text-lg font-extrabold text-flm-ink">Antes y después</h2>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    {report.photoUrl && (
                      <figure className="overflow-hidden rounded-xl border border-flm-line">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={report.photoUrl} alt="Antes: estado original del problema" className="h-48 w-full object-cover" />
                        <figcaption className="bg-flm-bg px-3 py-2 text-sm font-bold text-flm-muted">Antes</figcaption>
                      </figure>
                    )}
                    {report.evidenceUrls.slice(0, 2).map((u, i) => (
                      <figure key={u} className="overflow-hidden rounded-xl border border-flm-line">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={u} alt={`Después: evidencia de la solución ${i + 1}`} className="h-48 w-full object-cover" />
                        <figcaption className="bg-flm-bg px-3 py-2 text-sm font-bold text-flm-verified">Después</figcaption>
                      </figure>
                    ))}
                  </div>
                </section>
              )}

              {/* Acciones ciudadanas */}
              <div className="mt-6 flex flex-wrap gap-2 border-t border-flm-line pt-5">
                <Button
                  type="button"
                  variant={hasConfirmed ? "secondary" : "primary"}
                  onClick={handleConfirm}
                  disabled={confirming || hasConfirmed}
                >
                  {hasConfirmed ? "Ya lo confirmaste ✓" : confirming ? "Confirmando…" : "Yo también lo vi"}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={handleFollow}
                  disabled={following || authLoading}
                  aria-pressed={isFollowing}
                >
                  {following ? "…" : isFollowing ? "Siguiendo ✓" : "Seguir"}
                </Button>
              </div>
              <p className="mt-2 text-sm text-flm-muted">
                {report.confirmationsCount}{" "}
                {report.confirmationsCount === 1 ? "vecino confirma" : "vecinos confirman"} este
                problema
                {report.followersCount > 0 && (
                  <> · {report.followersCount} lo {report.followersCount === 1 ? "sigue" : "siguen"}</>
                )}
              </p>

              <div className="mt-4">
                <ShareButtons code={report.code} title={report.title} />
              </div>

              {notice && (
                <p role="status" className="mt-4 rounded-xl bg-flm-bg p-3 text-sm font-medium text-flm-ink">
                  {notice}
                </p>
              )}

              {/* Verificación ciudadana */}
              {inVerification && (
                <section aria-label="Verificación ciudadana" className="mt-6 rounded-2xl border border-flm-line bg-flm-bg p-4">
                  <h2 className="text-lg font-extrabold text-flm-ink">
                    ¿Se solucionó de verdad?
                  </h2>
                  <p className="mt-1 text-sm text-flm-muted">
                    La municipalidad informó una solución. Si pasas por ahí,
                    cuéntanos si el problema quedó resuelto.
                  </p>
                  {!user && !authLoading && (
                    <p className="mt-3 text-sm">
                      <button type="button" onClick={requireLogin} className="font-bold text-flm-accent underline">
                        Inicia sesión
                      </button>{" "}
                      para verificar.
                    </p>
                  )}
                  {(user || authLoading) && !vote && (
                    <div className="mt-3">
                      <label htmlFor="vote-comment" className="flm-label">
                        Comentario (opcional)
                      </label>
                      <textarea
                        id="vote-comment"
                        className="flm-input min-h-[80px]"
                        placeholder="Ej: Pasé ayer y el bache sigue igual…"
                        value={comment}
                        onChange={(e) => setComment(e.target.value)}
                        maxLength={300}
                      />
                      <div className="mt-3 flex gap-2">
                        <Button
                          type="button"
                          onClick={() => handleVote(true)}
                          disabled={voting}
                          className="!bg-flm-verified"
                        >
                          {voting ? "Enviando…" : "Sí, está solucionado"}
                        </Button>
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={() => handleVote(false)}
                          disabled={voting}
                        >
                          No, sigue igual
                        </Button>
                      </div>
                    </div>
                  )}
                  {vote && (
                    <p role="status" className="mt-3 text-sm font-bold text-flm-verified">
                      {vote === "approve"
                        ? "Votaste: solucionado ✓"
                        : "Votaste: no solucionado"}
                    </p>
                  )}
                </section>
              )}
            </div>
          </div>

          {/* Cronología: el endpoint devuelve TimelineItem[] real. */}
          <section aria-label="Cronología del reporte" className="flm-card mt-6 p-4 sm:p-6">
            <h2 className="text-lg font-extrabold text-flm-ink">Cronología</h2>
            {events === null ? (
              <Skeleton className="mt-3 h-16" />
            ) : (
              <div className="mt-3">
                <TimelineList items={events} variant="citizen" />
              </div>
            )}
          </section>
        </div>

        {/* Columna lateral: mini mapa */}
        <aside className="lg:col-span-2">
          <div className="overflow-hidden rounded-2xl border border-flm-line lg:sticky lg:top-20">
            <CitizenMap
              points={[
                {
                  code: report.code,
                  title: report.title,
                  state: report.state,
                  lng: report.publicLocation.lng,
                  lat: report.publicLocation.lat,
                },
              ]}
              center={report.publicLocation}
              zoom={16}
              className="h-64 w-full lg:h-80"
            />
          </div>
          <p className="mt-2 text-xs text-flm-muted">
            Ubicación aproximada por privacidad.
          </p>
        </aside>
      </div>
    </div>
  );
}
