"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, friendlyErrorMessage, type DuplicateCandidate } from "@/lib/flm/api";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Button, EmptyState, Skeleton } from "@/components/ui/primitives";
import { confirmedCodes, followedCodes } from "@/lib/flm/draft";
import { useAuth } from "@/lib/flm/auth";

/**
 * Paso 4 del wizard: revisión de duplicados.
 * Si ya existe un reporte cercano del mismo tipo, el vecino puede confirmar
 * ("Yo también lo vi") y seguirlo en vez de crear uno nuevo.
 */
export function DuplicateCheck({
  lng,
  lat,
  categoryId,
  onDifferentProblem,
}: {
  lng: number;
  lat: number;
  categoryId: string;
  onDifferentProblem: () => void;
}) {
  const router = useRouter();
  const { user } = useAuth();
  const [state, setState] = useState<"loading" | "error" | "ready">("loading");
  const [items, setItems] = useState<DuplicateCandidate[]>([]);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState("");

  // Al cambiar los parámetros de búsqueda se vuelve a "loading" durante el
  // render (patrón documentado de React): evita setState sincrónico dentro
  // del efecto.
  const requestKey = `${lng}|${lat}|${categoryId}`;
  const [lastRequestKey, setLastRequestKey] = useState(requestKey);
  if (lastRequestKey !== requestKey) {
    setLastRequestKey(requestKey);
    setState("loading");
  }

  useEffect(() => {
    let cancelled = false;
    api
      .duplicates({ lng, lat, categoryId })
      .then((res) => {
        if (cancelled) return;
        setItems(res.items ?? []);
        setState("ready");
      })
      .catch((err) => {
        if (cancelled) return;
        setErrorMsg(friendlyErrorMessage(err));
        setState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [lng, lat, categoryId]);

  async function handleConfirm(code: string) {
    if (!user) {
      router.push(`/login?next=${encodeURIComponent("/reportar")}`);
      return;
    }
    setConfirming(code);
    try {
      await api.confirm(code);
      try {
        await api.follow(code);
      } catch {
        /* seguir es opcional; la confirmación ya quedó */
      }
      confirmedCodes.add(code);
      followedCodes.add(code);
      router.push(`/reportes/${encodeURIComponent(code)}`);
    } catch (err) {
      setErrorMsg(friendlyErrorMessage(err));
      setConfirming(null);
    }
  }

  if (state === "loading") {
    return (
      <div aria-busy="true" aria-label="Buscando reportes cercanos">
        <Skeleton className="h-20" />
        <Skeleton className="mt-3 h-20" />
        <p className="mt-3 text-center text-sm text-flm-muted">
          Revisando si alguien ya reportó este problema…
        </p>
      </div>
    );
  }

  if (state === "error") {
    return (
      <EmptyState
        title="No pudimos revisar duplicados"
        description={`${errorMsg} Puedes continuar con tu reporte de todas formas.`}
        action={
          <Button type="button" onClick={onDifferentProblem}>
            Continuar con mi reporte
          </Button>
        }
      />
    );
  }

  if (items.length === 0) {
    return (
      <EmptyState
        title="Parece que eres la primera persona en reportarlo"
        description="No encontramos reportes cercanos del mismo tipo. ¡Buen ojo! Continúa para publicar el tuyo."
        action={
          <Button type="button" onClick={onDifferentProblem}>
            Continuar con mi reporte
          </Button>
        }
      />
    );
  }

  return (
    <div>
      <p className="text-sm text-flm-muted">
        Encontramos {items.length === 1 ? "un reporte cercano" : `${items.length} reportes cercanos`} del
        mismo tipo. Si es el mismo problema, confírmalo en vez de crear uno
        nuevo: así suma fuerza.
      </p>
      <ul className="mt-4 space-y-3">
        {items.map((d) => (
          <li key={d.code} className="flm-card p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-bold text-flm-ink">{d.title}</p>
                <p className="mt-1 text-sm text-flm-muted">
                  A {Math.round(d.distanceM)} metros · {d.code}
                </p>
                <div className="mt-2">
                  <StatusBadge state={d.state} />
                </div>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => handleConfirm(d.code)}
                disabled={confirming !== null}
              >
                {confirming === d.code ? "Confirmando…" : "Yo también lo vi"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => router.push(`/reportes/${encodeURIComponent(d.code)}`)}
              >
                Ver detalle
              </Button>
            </div>
          </li>
        ))}
      </ul>
      {errorMsg && (
        <p role="alert" className="mt-3 text-sm font-medium text-flm-pending">
          {errorMsg}
        </p>
      )}
      <div className="mt-6 border-t border-flm-line pt-4">
        <Button type="button" onClick={onDifferentProblem} className="w-full">
          Es un problema distinto, continuar
        </Button>
      </div>
    </div>
  );
}
