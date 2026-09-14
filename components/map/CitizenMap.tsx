"use client";

import dynamic from "next/dynamic";
import type { CitizenMapProps } from "./CitizenMapImpl";

export type { CitizenMapPoint, CitizenMapProps } from "./CitizenMapImpl";
export { PUDAHUEL_CENTER } from "./CitizenMapImpl";

/**
 * Mapa ciudadano. Se carga de forma diferida y solo en cliente
 * (MapLibre necesita window/document).
 */
const LazyMap = dynamic(
  () => import("./CitizenMapImpl").then((m) => m.CitizenMapImpl),
  {
    ssr: false,
    loading: () => (
      <div
        className="flm-skeleton flex h-full w-full items-center justify-center"
        role="status"
        aria-label="Cargando mapa"
      >
        <span className="text-sm font-medium text-flm-muted">Cargando mapa…</span>
      </div>
    ),
  }
);

export function CitizenMap(props: CitizenMapProps) {
  return <LazyMap {...props} />;
}
