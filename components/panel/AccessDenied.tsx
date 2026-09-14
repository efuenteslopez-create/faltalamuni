import Link from "next/link";
import { EmptyState } from "@/components/ui/primitives";

/**
 * Acceso denegado amable: no redirige en bucle, explica y ofrece login.
 */
export function AccessDenied({ reason }: { reason?: string }) {
  return (
    <EmptyState
      title="Esta zona es solo para funcionarios municipales"
      description={
        reason ??
        "El panel institucional requiere una cuenta de agente o gestora municipal de Pudahuel. Si tienes una cuenta, inicia sesión."
      }
      action={
        <div className="flex flex-col items-center gap-3 sm:flex-row">
          <Link href="/login" className="flm-btn-primary">
            Iniciar sesión
          </Link>
          <Link href="/" className="flm-btn-secondary">
            Volver al inicio
          </Link>
        </div>
      }
    />
  );
}
