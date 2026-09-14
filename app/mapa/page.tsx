import type { Metadata } from "next";
import { MapExplorer } from "@/components/citizen/MapExplorer";

export const metadata: Metadata = {
  title: "Mapa de reportes",
  description: "Explora todos los problemas reportados por vecinos en el mapa de tu comuna.",
};

export default function MapaPage() {
  return <MapExplorer />;
}
