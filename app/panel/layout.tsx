import type { Metadata } from "next";
import Link from "next/link";
import { IndependenceBanner } from "@/components/panel/IndependenceBanner";
import { PanelNav } from "@/components/panel/PanelNav";

export const metadata: Metadata = {
  title: "Panel institucional",
  description:
    "Bandeja operativa, analítica y gestión de reportes ciudadanos para la Municipalidad de Pudahuel.",
};

export default function PanelLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-flm-bg">
      <header className="border-b border-flm-line bg-flm-surface">
        <div className="flm-container flex flex-wrap items-center justify-between gap-2 py-3">
          <Link
            href="/panel"
            className="text-base font-extrabold tracking-tight text-flm-ink"
          >
            FLM <span className="font-semibold text-flm-muted">· Panel institucional · Pudahuel</span>
          </Link>
          <PanelNav />
        </div>
      </header>
      <IndependenceBanner />
      <main className="flm-container py-6">{children}</main>
      <footer className="flm-container pb-8 text-xs text-flm-muted">
        <p>
          Plataforma independiente de la municipalidad.{" "}
          <Link href="/transparencia" className="underline">
            Cómo garantizamos la independencia
          </Link>{" "}
          ·{" "}
          <Link href="/metodologia" className="underline">
            Metodología de indicadores
          </Link>
        </p>
      </footer>
    </div>
  );
}
