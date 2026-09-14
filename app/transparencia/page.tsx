import type { Metadata } from "next";
import Link from "next/link";
import { Card } from "@/components/ui/primitives";

export const metadata: Metadata = {
  title: "Transparencia e independencia",
  description:
    "Qué puede y no puede hacer una municipalidad en Falta la Muni, y las garantías técnicas que lo aseguran.",
};

function Check({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-2.5">
      <svg viewBox="0 0 16 16" className="mt-0.5 h-4 w-4 shrink-0 text-flm-verified" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden>
        <path d="M3 8.5l3.5 3.5L13 4.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span>{children}</span>
    </li>
  );
}

function Cross({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-2.5">
      <svg viewBox="0 0 16 16" className="mt-0.5 h-4 w-4 shrink-0 text-flm-pending" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden>
        <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
      </svg>
      <span>{children}</span>
    </li>
  );
}

/**
 * Principio de independencia: qué puede y no puede hacer una municipalidad,
 * y las garantías técnicas que lo respaldan.
 */
export default function TransparenciaPage() {
  return (
    <div className="min-h-screen bg-flm-bg">
      <div className="flm-container max-w-3xl py-8">
        <Link href="/" className="text-sm font-semibold text-flm-institutional underline">
          ← Volver al inicio
        </Link>
        <h1 className="mt-3 text-3xl font-extrabold text-flm-ink">
          Transparencia e independencia
        </h1>
        <p className="mt-2 text-flm-muted">
          Falta la Muni es una plataforma independiente de las municipalidades.
          Las instituciones participan para gestionar y responder, pero el
          control sobre los datos ciudadanos y la verificación de soluciones no
          les pertenece. Esto no es una promesa: está implementado en el
          sistema.
        </p>

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <Card>
            <h2 className="text-lg font-bold text-flm-ink">
              Una municipalidad sí puede
            </h2>
            <ul className="mt-3 space-y-2.5 text-sm text-flm-ink">
              <Check>Reconocer la recepción de un reporte.</Check>
              <Check>Clasificarlo e identificar al responsable directo.</Check>
              <Check>Asignarlo a un departamento y hacer seguimiento interno.</Check>
              <Check>Derivarlo con fundamento a otra agencia (SERVIU, MOP, empresas de servicios).</Check>
              <Check>Responder públicamente a la comunidad.</Check>
              <Check>Subir evidencia del trabajo realizado (antes/después).</Check>
              <Check>Informar una solución y pedir verificación ciudadana.</Check>
              <Check>Exportar sus datos de gestión en CSV.</Check>
            </ul>
          </Card>
          <Card>
            <h2 className="text-lg font-bold text-flm-ink">
              Una municipalidad no puede
            </h2>
            <ul className="mt-3 space-y-2.5 text-sm text-flm-ink">
              <Cross>Editar el texto, fotos o ubicación del reporte ciudadano.</Cross>
              <Cross>Eliminar un reporte o sus comentarios.</Cross>
              <Cross>Verificar unilateralmente que una solución está lista.</Cross>
              <Cross>Ocultar reportes o cambiar sus indicadores.</Cross>
              <Cross>Ver las notas internas de otras organizaciones.</Cross>
              <Cross>Modificar la historia auditable de un caso.</Cross>
            </ul>
          </Card>
        </div>

        <Card className="mt-6">
          <h2 className="text-lg font-bold text-flm-ink">Garantías técnicas</h2>
          <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm text-flm-muted">
            <li>
              <strong className="text-flm-ink">Reportes inmutables:</strong> el
              contenido original del vecino no tiene operación de edición para
              ningún rol institucional, ni siquiera para administradores de la
              plataforma en forma silenciosa.
            </li>
            <li>
              <strong className="text-flm-ink">Verificación independiente:</strong> el
              estado “solucionado verificado” solo lo pueden otorgar la
              comunidad o verificadores independientes. La máquina de estados lo
              impide técnicamente para roles institucionales.
            </li>
            <li>
              <strong className="text-flm-ink">Historial append-only:</strong> cada
              cambio de estado queda registrado con actor, fecha y fundamento.
              Nada se borra ni se reescribe.
            </li>
            <li>
              <strong className="text-flm-ink">Control de concurrencia:</strong> las
              acciones institucionales usan versiones; si dos funcionarios
              actúan a la vez, el segundo recibe un aviso de conflicto en lugar
              de sobrescribir.
            </li>
            <li>
              <strong className="text-flm-ink">Notas internas separadas:</strong> la
              coordinación interna de cada organización nunca se mezcla con el
              contenido público.
            </li>
            <li>
              <strong className="text-flm-ink">Indicadores calculados por la plataforma:</strong> las
              métricas se derivan de eventos auditables con fórmulas públicas
              (ver <Link href="/metodologia" className="underline">metodología</Link>).
            </li>
          </ul>
        </Card>

        <p className="mt-6 text-sm text-flm-muted">
          ¿Eres de una municipalidad y quieres operar con estas reglas?{" "}
          <Link href="/municipios" className="underline">
            Conoce Falta la Muni para municipios
          </Link>
          .
        </p>
      </div>
    </div>
  );
}
