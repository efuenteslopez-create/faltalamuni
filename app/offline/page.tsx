import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Sin conexión",
};

export default function OfflinePage() {
  return (
    <main className="flm-container flex min-h-[70vh] flex-col items-center justify-center text-center">
      <div className="flm-card max-w-md p-8">
        <h1 className="text-2xl font-bold text-flm-ink">Sin conexión</h1>
        <p className="mt-3 text-flm-muted">
          Parece que no tienes internet en este momento. Puedes seguir revisando
          las páginas que ya visitaste. Tus reportes en borrador se guardan en
          este dispositivo y se enviarán cuando vuelva la conexión.
        </p>
        <Link href="/" className="flm-btn-primary mt-6 w-full">
          Volver al inicio
        </Link>
      </div>
    </main>
  );
}
