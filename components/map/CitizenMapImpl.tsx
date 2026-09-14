"use client";

/**
 * Implementación del mapa ciudadano con MapLibre GL.
 * Se carga solo en cliente (ver CitizenMap.tsx) y de forma diferida.
 */
import { useEffect, useRef } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  REPORT_STATE_GROUPS,
  REPORT_STATE_LABELS,
  type ReportState,
} from "@/lib/domain/types";

export interface CitizenMapPoint {
  code: string;
  title: string;
  state: ReportState;
  lng: number;
  lat: number;
}

export interface CitizenMapProps {
  points: CitizenMapPoint[];
  center: { lng: number; lat: number };
  zoom?: number;
  className?: string;
  /** Agrupa puntos cercanos (útil en el explorador con muchos reportes). */
  cluster?: boolean;
  /** Modo "elige ubicación": el pin queda fijo al centro y se reporta el centro al mover. */
  pickMode?: boolean;
  onPick?: (lng: number, lat: number) => void;
  onSelect?: (code: string) => void;
}

const GROUP_COLORS: Record<string, string> = {
  pending: "#DC2626",
  progress: "#B45309",
  verified: "#15803D",
  neutral: "#78716C",
};

/** Pudahuel, centro por defecto de la comuna. */
export const PUDAHUEL_CENTER = { lng: -70.7449, lat: -33.4378 };

function buildStyle(): maplibregl.StyleSpecification {
  const tilesUrl = process.env.NEXT_PUBLIC_MAP_TILES_URL;
  const attribution = process.env.NEXT_PUBLIC_MAP_ATTRIBUTION ?? "";
  if (tilesUrl) {
    return {
      version: 8,
      sources: {
        flm: {
          type: "raster",
          tiles: [tilesUrl],
          tileSize: 256,
          attribution,
        },
      },
      layers: [{ id: "flm-base", type: "raster", source: "flm" }],
    } as maplibregl.StyleSpecification;
  }
  // Respaldo público mientras no hay proveedor de tiles configurado.
  return "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json" as unknown as maplibregl.StyleSpecification;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function popupHtml(p: CitizenMapPoint): string {
  const label = REPORT_STATE_LABELS[p.state];
  return `
    <div style="max-width:220px;font-family:inherit">
      <p style="font-weight:700;font-size:14px;margin:0 0 4px;color:#1C1917">${escapeHtml(p.title)}</p>
      <p style="font-size:12px;margin:0 0 8px;color:#78716C">${escapeHtml(label)} · ${escapeHtml(p.code)}</p>
      <a href="/reportes/${escapeHtml(p.code)}" style="display:inline-block;font-size:13px;font-weight:700;color:#C2410C">Ver reporte →</a>
    </div>`;
}

export function CitizenMapImpl({
  points,
  center,
  zoom = 13,
  className,
  cluster = false,
  pickMode = false,
  onPick,
  onSelect,
}: CitizenMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const propsRef = useRef({ points, onSelect, pickMode, onPick });
  propsRef.current = { points, onSelect, pickMode, onPick };

  /* Crear el mapa una sola vez */
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: buildStyle(),
      center: [center.lng, center.lat],
      zoom,
      attributionControl: { compact: true },
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    mapRef.current = map;

    map.on("moveend", () => {
      const { pickMode: pm, onPick: op } = propsRef.current;
      if (pm && op) {
        const c = map.getCenter();
        op(c.lng, c.lat);
      }
    });

    if (cluster) {
      map.on("load", () => setupClusters(map));
      // Click en un punto no agrupado → popup
      map.on("click", "flm-points", (e: maplibregl.MapLayerMouseEvent) => {
        const f = e.features?.[0];
        if (!f) return;
        const p = f.properties as unknown as CitizenMapPoint;
        new maplibregl.Popup({ offset: 12, closeButton: true })
          .setLngLat([p.lng, p.lat])
          .setHTML(popupHtml(p))
          .addTo(map);
      });
      map.on("click", "flm-clusters", (e: maplibregl.MapLayerMouseEvent) => {
        const f = e.features?.[0];
        if (!f) return;
        const src = map.getSource("flm-reports") as maplibregl.GeoJSONSource;
        const clusterId = (f.properties as { cluster_id: number }).cluster_id;
        src
          .getClusterExpansionZoom(clusterId)
          .then((zoom) => {
            map.easeTo({
              center: (f.geometry as GeoJSON.Point).coordinates as [number, number],
              zoom,
            });
          })
          .catch(() => {
            /* noop */
          });
      });
      map.on("mouseenter", "flm-clusters", () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", "flm-clusters", () => { map.getCanvas().style.cursor = ""; });
      map.on("mouseenter", "flm-points", () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", "flm-points", () => { map.getCanvas().style.cursor = ""; });
    }

    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Puntos: fuente clusterizada o marcadores individuales */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (cluster) {
      const apply = () => {
        const src = map.getSource("flm-reports") as maplibregl.GeoJSONSource | undefined;
        if (src) src.setData(toGeoJSON(points));
      };
      if (map.isStyleLoaded()) apply();
      else map.once("load", apply);
      return;
    }

    // Marcadores individuales con color por grupo de estado
    for (const m of markersRef.current) m.remove();
    markersRef.current = points.map((p) => {
      const el = document.createElement("button");
      el.type = "button";
      el.className = "flm-marker";
      el.setAttribute("aria-label", `${p.title} — ${REPORT_STATE_LABELS[p.state]}`);
      const color = GROUP_COLORS[REPORT_STATE_GROUPS[p.state]] ?? GROUP_COLORS.neutral;
      el.style.cssText = `width:22px;height:22px;border-radius:9999px;background:${color};border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.35);cursor:pointer;padding:0;`;
      el.addEventListener("click", (ev) => {
        ev.stopPropagation();
        const sel = propsRef.current.onSelect;
        if (sel) {
          sel(p.code);
          return;
        }
        new maplibregl.Popup({ offset: 14, closeButton: true })
          .setLngLat([p.lng, p.lat])
          .setHTML(popupHtml(p))
          .addTo(map);
      });
      return new maplibregl.Marker({ element: el }).setLngLat([p.lng, p.lat]).addTo(map);
    });
  }, [points, cluster]);

  /* Recenter externo (p.ej. GPS) */
  useEffect(() => {
    const map = mapRef.current;
    if (map) map.easeTo({ center: [center.lng, center.lat], duration: 600 });
  }, [center.lng, center.lat]);

  return (
    <div className={className} style={{ position: "relative" }}>
      <div ref={containerRef} className="h-full w-full" role="application" aria-label="Mapa de reportes" />
      {pickMode && (
        <div
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-full"
        >
          <svg viewBox="0 0 24 32" className="h-10 w-8 drop-shadow-md">
            <path
              d="M12 31s-9-8.6-9-16a9 9 0 0 1 18 0c0 7.4-9 16-9 16z"
              fill="#C2410C"
              stroke="#fff"
              strokeWidth="1.5"
            />
            <circle cx="12" cy="14.5" r="3.4" fill="#fff" />
          </svg>
        </div>
      )}
    </div>
  );
}

function toGeoJSON(points: CitizenMapPoint[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: points.map((p) => ({
      type: "Feature" as const,
      geometry: { type: "Point" as const, coordinates: [p.lng, p.lat] },
      properties: {
        code: p.code,
        title: p.title,
        state: p.state,
        lng: p.lng,
        lat: p.lat,
        group: REPORT_STATE_GROUPS[p.state],
      },
    })),
  };
}

function setupClusters(map: maplibregl.Map) {
  if (map.getSource("flm-reports")) return;
  map.addSource("flm-reports", {
    type: "geojson",
    data: toGeoJSON([]),
    cluster: true,
    clusterMaxZoom: 14,
    clusterRadius: 48,
  });
  map.addLayer({
    id: "flm-clusters",
    type: "circle",
    source: "flm-reports",
    filter: ["has", "point_count"],
    paint: {
      "circle-color": "#1D4ED8",
      "circle-radius": ["step", ["get", "point_count"], 16, 10, 22, 30, 28],
      "circle-stroke-width": 3,
      "circle-stroke-color": "#fff",
    },
  });
  map.addLayer({
    id: "flm-cluster-count",
    type: "symbol",
    source: "flm-reports",
    filter: ["has", "point_count"],
    layout: {
      "text-field": "{point_count_abbreviated}",
      "text-font": ["Noto Sans Regular"],
      "text-size": 12,
    },
    paint: { "text-color": "#fff" },
  });
  map.addLayer({
    id: "flm-points",
    type: "circle",
    source: "flm-reports",
    filter: ["!", ["has", "point_count"]],
    paint: {
      "circle-radius": 9,
      "circle-stroke-width": 2.5,
      "circle-stroke-color": "#fff",
      "circle-color": [
        "match",
        ["get", "group"],
        "pending", GROUP_COLORS.pending,
        "progress", GROUP_COLORS.progress,
        "verified", GROUP_COLORS.verified,
        GROUP_COLORS.neutral,
      ],
    },
  });
}
