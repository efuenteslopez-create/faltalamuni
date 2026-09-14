import type { Metadata } from "next";
import { HomeView } from "@/components/citizen/HomeView";

export const metadata: Metadata = {
  title: "Falta la Muni — El mapa ciudadano de tu comuna",
  description:
    "Problemas a la vista. Soluciones también. Reporta problemas urbanos, hazles seguimiento y verifica las soluciones.",
};

export default function HomePage() {
  return <HomeView />;
}
