import type { Metadata } from "next";
import Link from "next/link";
import { Card } from "@/components/ui/primitives";

export const metadata: Metadata = {
  title: "Términos de Uso",
  description:
    "Términos de uso de Falta la Muni: reglas de la comunidad, independencia institucional y responsabilidades.",
};

/**
 * Términos de uso reales y sobrios.
 */
export default function TerminosPage() {
  return (
    <div className="min-h-screen bg-flm-bg">
      <div className="flm-container max-w-3xl py-8">
        <Link href="/" className="text-sm font-semibold text-flm-institutional underline">
          ← Volver al inicio
        </Link>
        <h1 className="mt-3 text-3xl font-extrabold text-flm-ink">
          Términos de Uso
        </h1>
        <p className="mt-2 text-sm text-flm-muted">
          Última actualización: septiembre de 2026.
        </p>

        <div className="mt-6 space-y-4 text-sm leading-relaxed">
          <Card>
            <h2 className="text-lg font-bold text-flm-ink">1. Qué es Falta la Muni</h2>
            <p className="mt-2 text-flm-muted">
              Falta la Muni (“FLM”, “la plataforma”) es un servicio independiente
              que permite reportar problemas urbanos, darles seguimiento público
              y verificar sus soluciones. No somos un organismo público ni
              hablamos en nombre de ninguna municipalidad.
            </p>
          </Card>

          <Card>
            <h2 className="text-lg font-bold text-flm-ink">2. Tus reportes</h2>
            <ul className="mt-2 list-disc space-y-1.5 pl-5 text-flm-muted">
              <li>
                Al publicar un reporte declaras que la información es veraz y
                corresponde a un problema real de tu comuna.
              </li>
              <li>
                El contenido de tu reporte (texto, fotos, ubicación pública) es
                público y queda registrado de forma permanente como parte del
                registro ciudadano. No podrás editarlo una vez publicado; si
                contiene un error relevante, contáctanos.
              </li>
              <li>
                Puedes elegir que tu nombre no aparezca públicamente. Aun así,
                tu identidad queda registrada internamente para fines de
                seguridad y moderación.
              </li>
            </ul>
          </Card>

          <Card>
            <h2 className="text-lg font-bold text-flm-ink">3. Reglas de la comunidad</h2>
            <ul className="mt-2 list-disc space-y-1.5 pl-5 text-flm-muted">
              <li>No publiques datos personales de terceros (nombres, direcciones, patentes, teléfonos).</li>
              <li>No publiques contenido falso, difamatorio, discriminatorio o que incite a la violencia.</li>
              <li>No uses la plataforma para propaganda electoral ni fines comerciales.</li>
              <li>No intentes vulnerar la seguridad del servicio ni suplantar a otras personas o instituciones.</li>
            </ul>
            <p className="mt-2 text-flm-muted">
              El incumplimiento puede llevar a la restricción de tu cuenta o del
              contenido, siempre con fundamento y dejando registro auditable.
              La moderación la realiza un equipo independiente, no las
              municipalidades.
            </p>
          </Card>

          <Card>
            <h2 className="text-lg font-bold text-flm-ink">4. Verificación de soluciones</h2>
            <p className="mt-2 text-flm-muted">
              Cuando una institución informa una solución, la comunidad puede
              verificarla en terreno o reabrir el caso con fundamento si la
              considera insuficiente. Ninguna institución puede declarar
              unilateralmente que un problema está resuelto: el sello “Ya
              estuvo la Muni” solo se otorga con verificación ciudadana o
              independiente.
            </p>
          </Card>

          <Card>
            <h2 className="text-lg font-bold text-flm-ink">5. Rol de las instituciones</h2>
            <p className="mt-2 text-flm-muted">
              Las municipalidades y agencias participantes usan la plataforma
              para gestionar y responder reportes, bajo el principio de
              independencia descrito en nuestra{" "}
              <Link href="/transparencia" className="underline">
                página de transparencia
              </Link>
              . Sus respuestas son de su exclusiva responsabilidad.
            </p>
          </Card>

          <Card>
            <h2 className="text-lg font-bold text-flm-ink">6. Responsabilidades y límites</h2>
            <ul className="mt-2 list-disc space-y-1.5 pl-5 text-flm-muted">
              <li>
                FLM es un canal de reporte y seguimiento ciudadano, no un
                servicio de emergencia. Ante riesgo inminente, llama a los
                números de emergencia correspondientes.
              </li>
              <li>
                No garantizamos tiempos de respuesta de las instituciones ni que
                un problema reportado será solucionado.
              </li>
              <li>
                El servicio se entrega “tal cual”, con esfuerzos razonables de
                disponibilidad y seguridad, sin garantías adicionales.
              </li>
            </ul>
          </Card>

          <Card>
            <h2 className="text-lg font-bold text-flm-ink">7. Cambios y contacto</h2>
            <p className="mt-2 text-flm-muted">
              Podemos actualizar estos términos informando previamente en la
              plataforma. Si tienes preguntas, escríbenos a{" "}
              <a href="mailto:contacto@faltalamuni.cl" className="underline">
                contacto@faltalamuni.cl
              </a>
              .
            </p>
          </Card>
        </div>
      </div>
    </div>
  );
}
