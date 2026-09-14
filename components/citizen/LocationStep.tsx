"use client";

import { useCallback, useState } from "react";
import { CitizenMap, PUDAHUEL_CENTER } from "@/components/map/CitizenMap";
import { Button } from "@/components/ui/primitives";
import type { GeoPoint } from "@/lib/domain/types";

type GpsStatus = "idle" | "loading" | "ok" | "denied" | "error" | "unsupported";

/**
 * Paso 2 del wizard: ubicación del problema.
 * Pide permiso de geolocalización con explicación contextual; si se deniega
 * (o no hay GPS), se ofrece el mapa manual centrado en Pudahuel.
 */
export function LocationStep({
  value,
  onChange,
}: {
  value: GeoPoint | null;
  onChange: (p: GeoPoint) => void;
}) {
  const [gps, setGps] = useState<GpsStatus>("idle");
  const [mapCenter, setMapCenter] = useState<GeoPoint>(value ?? PUDAHUEL_CENTER);

  const requestGps = useCallback(() => {
    if (!("geolocation" in navigator)) {
      setGps("unsupported");
      return;
    }
    setGps("loading");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const p = { lng: pos.coords.longitude, lat: pos.coords.latitude };
        setGps("ok");
        setMapCenter(p);
        onChange(p);
      },
      (err) => {
        setGps(err.code === err.PERMISSION_DENIED ? "denied" : "error");
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 }
    );
  }, [onChange]);

  const handlePick = useCallback(
    (lng: number, lat: number) => {
      onChange({ lng, lat });
    },
    [onChange]
  );

  return (
    <div>
      <p className="text-sm text-flm-muted">
        Usamos tu ubicación para situar el problema en el mapa. Puedes mover el
        mapa para ajustar el pin exactamente donde está el problema.
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          type="button"
          variant={value ? "secondary" : "primary"}
          onClick={requestGps}
          disabled={gps === "loading"}
        >
          {gps === "loading" ? (
            "Buscando tu ubicación…"
          ) : (
            <>
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                <circle cx="12" cy="12" r="3" />
                <path d="M12 2v3M12 19v3M2 12h3M19 12h3" strokeLinecap="round" />
                <circle cx="12" cy="12" r="8" strokeDasharray="3 3" />
              </svg>
              Usar mi ubicación actual
            </>
          )}
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            setMapCenter(PUDAHUEL_CENTER);
            onChange(PUDAHUEL_CENTER);
          }}
        >
          Centrar en Pudahuel
        </Button>
      </div>

      {(gps === "denied" || gps === "unsupported") && (
        <p role="status" className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-flm-progress">
          {gps === "denied"
            ? "No pudimos acceder a tu ubicación. Mueve el mapa con el dedo para poner el pin donde está el problema."
            : "Tu dispositivo no tiene GPS disponible. Mueve el mapa con el dedo para poner el pin donde está el problema."}
        </p>
      )}
      {gps === "error" && (
        <p role="alert" className="mt-3 rounded-xl bg-red-50 p-3 text-sm text-flm-pending">
          No logramos obtener tu ubicación. Intenta de nuevo o ajusta el pin en el mapa.
        </p>
      )}

      <div className="mt-4 overflow-hidden rounded-2xl border border-flm-line">
        <CitizenMap
          points={[]}
          center={mapCenter}
          zoom={value ? 16 : 13}
          pickMode
          onPick={handlePick}
          className="h-72 w-full sm:h-80"
        />
      </div>
      <p className="mt-2 text-center text-sm font-medium text-flm-muted" aria-live="polite">
        {value
          ? `Pin ubicado: ${value.lat.toFixed(5)}, ${value.lng.toFixed(5)}`
          : "Mueve el mapa para ubicar el pin"}
      </p>
    </div>
  );
}
