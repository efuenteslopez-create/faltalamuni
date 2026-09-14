import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Página no encontrada" };

export default function NotFound() {
  return (
    <main className="flm-container flex min-h-[70vh] flex-col items-center justify-center text-center">
      <p className="text-6xl font-black text-flm-line">404</p>
      <h1 className="mt-2 text-2xl font-bold text-flm-ink">
        Esta dirección no existe
      </h1>
      <p className="mt-3 max-w-md text-flm-muted">
        La página que buscas fue movida o nunca existió. Pero los problemas de
        tu comuna sí existen y están en el mapa.
      </p>
      <Link href="/" className="flm-btn-primary mt-6">
        Ir al mapa ciudadano
      </Link>
    </main>
  );
}
