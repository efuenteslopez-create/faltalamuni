/**
 * FLM — Utilidades de dominio: códigos públicos y geo.
 */
import { GeoPoint } from "./types";

/** Genera código público legible: FLM-PUD-000123 (secuencial por comuna). */
export function formatReportCode(communePrefix: string, sequence: number): string {
  return `FLM-${communePrefix}-${String(sequence).padStart(6, "0")}`;
}

/**
 * Distancia haversiana en metros entre dos puntos.
 * El adaptador demo la usa para búsqueda por radio; en PostGIS se reemplaza
 * por ST_DWithin(geography, geography, metros).
 */
export function haversineMeters(a: GeoPoint, b: GeoPoint): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Aproxima coordenadas públicas para categorías sensibles (privacidad §14).
 * Desplaza el punto a una grilla de ~150m para no exponer domicilios exactos.
 */
export function approximatePublicLocation(p: GeoPoint): GeoPoint {
  const grid = 0.00135; // ~150m
  return {
    lng: Math.round(p.lng / grid) * grid,
    lat: Math.round(p.lat / grid) * grid,
  };
}
