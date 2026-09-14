"use client";

import { useEffect, useRef, useState } from "react";
import "maplibre-gl/dist/maplibre-gl.css";
import type {
  ExpressionSpecification,
  GeoJSONSource,
  Map as MLMap,
} from "maplibre-gl";

/** Punto con ubicación pública (aproximada si la categoría es sensible). */
export interface HeatPoint {
  lng: number;
  lat: number;
}

interface CellFeature {
  type: "Feature";
  geometry: { type: "Polygon"; coordinates: number[][][] };
  properties: { count: number };
}

interface CellCollection {
  type: "FeatureCollection";
  features: CellFeature[];
}

const CELL_METERS = 300;
const PUD_CENTER: [number, number] = [-70.75, -33.44];

/** Agrega puntos en celdas de ~300 m. */
function buildCells(points: HeatPoint[]): CellCollection {
  const counts = new Map<string, { count: number; lat: number; lng: number }>();
  for (const p of points) {
    if (!Number.isFinite(p.lng) || !Number.isFinite(p.lat)) continue;
    const dLat = CELL_METERS / 111320;
    const dLng =
      CELL_METERS / (111320 * Math.cos((p.lat * Math.PI) / 180));
    const iy = Math.floor(p.lat / dLat);
    const ix = Math.floor(p.lng / dLng);
    const key = `${ix},${iy}`;
    const cLat = (iy + 0.5) * dLat;
    const cLng = (ix + 0.5) * dLng;
    const prev = counts.get(key);
    if (prev) prev.count += 1;
    else counts.set(key, { count: 1, lat: cLat, lng: cLng });
  }
  const features: CellFeature[] = [];
  counts.forEach(({ count, lat, lng }) => {
    const dLat = CELL_METERS / 111320 / 2;
    const dLng = CELL_METERS / (111320 * Math.cos((lat * Math.PI) / 180)) / 2;
    features.push({
      type: "Feature",
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [lng - dLng, lat - dLat],
            [lng + dLng, lat - dLat],
            [lng + dLng, lat + dLat],
            [lng - dLng, lat + dLat],
            [lng - dLng, lat - dLat],
          ],
        ],
      },
      properties: { count },
    });
  });
  return { type: "FeatureCollection", features };
}

const FILL_COLOR: ExpressionSpecification = [
  "interpolate",
  ["linear"],
  ["get", "count"],
  1,
  "#FED7AA",
  3,
  "#FB923C",
  6,
  "#C2410C",
  12,
  "#7C2D12",
];

/**
 * Mapa de calor operacional: agrega reportes por celda de ~300 m y pinta
 * la intensidad. Se carga solo en cliente (dynamic ssr:false en la página).
 */
export function Heatmap({ points }: { points: HeatPoint[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  // Crear el mapa una vez.
  useEffect(() => {
    let cancelled = false;
    let map: MLMap | null = null;
    (async () => {
      try {
        const ml = await import("maplibre-gl");
        if (cancelled || !containerRef.current) return;
        const tiles =
          process.env.NEXT_PUBLIC_MAP_TILES_URL ??
          "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
        map = new ml.Map({
          container: containerRef.current,
          style: {
            version: 8,
            sources: {
              osm: {
                type: "raster",
                tiles: [tiles],
                tileSize: 256,
                attribution:
                  process.env.NEXT_PUBLIC_MAP_ATTRIBUTION ??
                  "© OpenStreetMap contributors",
              },
            },
            layers: [{ id: "osm", type: "raster", source: "osm" }],
          },
          center: PUD_CENTER,
          zoom: 12,
        });
        map.addControl(new ml.NavigationControl(), "top-right");
        map.on("load", () => {
          if (cancelled || !map) return;
          map.addSource("heat", {
            type: "geojson",
            data: buildCells([]),
          });
          map.addLayer({
            id: "heat-cells",
            type: "fill",
            source: "heat",
            paint: {
              "fill-color": FILL_COLOR,
              "fill-opacity": 0.55,
              "fill-outline-color": "#7C2D12",
            },
          });
          mapRef.current = map;
          setReady(true);
        });
        map.on("error", () => setFailed(true));
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
      map?.remove();
      mapRef.current = null;
    };
  }, []);

  // Actualizar celdas cuando llegan los puntos.
  useEffect(() => {
    if (!ready || !mapRef.current) return;
    const src = mapRef.current.getSource("heat") as
      | GeoJSONSource
      | undefined;
    src?.setData(buildCells(points));
    if (points.length > 0) {
      const lngs = points.map((p) => p.lng);
      const lats = points.map((p) => p.lat);
      mapRef.current.fitBounds(
        [
          [Math.min(...lngs), Math.min(...lats)],
          [Math.max(...lngs), Math.max(...lats)],
        ],
        { padding: 48, maxZoom: 14 }
      );
    }
  }, [points, ready]);

  if (failed) {
    return (
      <div className="flm-card flex h-[380px] items-center justify-center p-6 text-center">
        <p className="text-flm-muted">
          No se pudo cargar el mapa. Revisa tu conexión e inténtalo de nuevo.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div
        ref={containerRef}
        className="h-[380px] w-full overflow-hidden rounded-2xl border border-flm-line sm:h-[440px]"
        role="img"
        aria-label="Mapa de calor de reportes por sector: celdas de 300 metros coloreadas según cantidad de reportes"
      />
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-flm-muted">
        <span className="font-semibold">Intensidad por celda (~300 m):</span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded-sm bg-[#FED7AA]" aria-hidden /> 1 reporte
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded-sm bg-[#FB923C]" aria-hidden /> 3+
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded-sm bg-[#C2410C]" aria-hidden /> 6+
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded-sm bg-[#7C2D12]" aria-hidden /> 12+
        </span>
      </div>
    </div>
  );
}
