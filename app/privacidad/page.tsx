import type { Metadata } from "next";
import Link from "next/link";
import { Card } from "@/components/ui/primitives";

export const metadata: Metadata = {
  title: "Política de Privacidad",
  description:
    "Cómo Falta la Muni trata tus datos personales conforme a la Ley 19.628 sobre protección de la vida privada.",
};

/**
 * Política de privacidad real y sobria, conforme a la Ley 19.628.
 */
export default function PrivacidadPage() {
  return (
    <div className="min-h-screen bg-flm-bg">
      <div className="flm-container max-w-3xl py-8">
        <Link href="/" className="text-sm font-semibold text-flm-institutional underline">
          ← Volver al inicio
        </Link>
        <h1 className="mt-3 text-3xl font-extrabold text-flm-ink">
          Política de Privacidad
        </h1>
        <p className="mt-2 text-sm text-flm-muted">
          Última actualización: septiembre de 2026.
        </p>

        <div className="mt-6 space-y-4 text-sm leading-relaxed text-flm-ink">
          <Card>
            <h2 className="text-lg font-bold">1. Quiénes somos</h2>
            <p className="mt-2 text-flm-muted">
              Falta la Muni (“FLM”) es una plataforma independiente que permite
              a las personas reportar problemas urbanos de su comuna, hacerles
              seguimiento y verificar sus soluciones. Somos responsables del
              tratamiento de tus datos personales conforme a la Ley N° 19.628
              sobre protección de la vida privada.
            </p>
          </Card>

          <Card>
            <h2 className="text-lg font-bold">2. Qué datos recogemos</h2>
            <ul className="mt-2 list-disc space-y-1.5 pl-5 text-flm-muted">
              <li>
                <strong className="text-flm-ink">Datos de cuenta:</strong> nombre,
                correo electrónico y comuna, cuando te registras.
              </li>
              <li>
                <strong className="text-flm-ink">Contenido de reportes:</strong>{" "}
                título, descripción, fotografías y ubicación del problema que
                reportas. Tú decides si tu nombre aparece públicamente o si
                reportas de forma anónima ante la comunidad.
              </li>
              <li>
                <strong className="text-flm-ink">Datos de uso:</strong> eventos
                necesarios para operar la plataforma (inicios de sesión,
                confirmaciones, verificaciones), registrados con fines de
                seguridad y auditoría.
              </li>
            </ul>
            <p className="mt-2 text-flm-muted">
              No recogemos datos sensibles (salud, creencias, orientación) ni los
              necesitamos para operar.
            </p>
          </Card>

          <Card>
            <h2 className="text-lg font-bold">3. Para qué los usamos</h2>
            <ul className="mt-2 list-disc space-y-1.5 pl-5 text-flm-muted">
              <li>Publicar y dar seguimiento a tus reportes ciudadanos.</li>
              <li>Permitir que las instituciones gestionen y respondan los casos.</li>
              <li>Calcular indicadores agregados de gestión comunal.</li>
              <li>Garantizar la seguridad y la trazabilidad de la plataforma.</li>
            </ul>
            <p className="mt-2 text-flm-muted">
              No vendemos tus datos ni los usamos para publicidad. No los
              compartimos con terceros salvo obligación legal o cuando tú lo
              autorizas expresamente.
            </p>
          </Card>

          <Card>
            <h2 className="text-lg font-bold">4. Ubicación y privacidad</h2>
            <p className="mt-2 text-flm-muted">
              Los reportes se muestran en el mapa con su ubicación pública. Si
              la categoría del problema es sensible (por ejemplo, situaciones
              que podrían exponerte), las coordenadas públicas se aproximan
              automáticamente. La ubicación exacta solo es visible para fines
              operativos restringidos y nunca se publica.
            </p>
          </Card>

          <Card>
            <h2 className="text-lg font-bold">5. Tus derechos (Ley 19.628)</h2>
            <p className="mt-2 text-flm-muted">
              Tienes derecho a acceder, rectificar, cancelar u oponerte al
              tratamiento de tus datos personales. Para ejercerlos, escríbenos a{" "}
              <a href="mailto:privacidad@faltalamuni.cl" className="underline">
                privacidad@faltalamuni.cl
              </a>{" "}
              indicando tu solicitud y un medio para verificar tu identidad.
              Responderemos dentro de los plazos legales.
            </p>
            <p className="mt-2 text-flm-muted">
              Ten en cuenta que los reportes ya publicados forman parte del
              registro público ciudadano: al ejercer tu derecho de cancelación
              anonimizamos tus datos personales, pero el contenido del reporte
              puede conservarse de forma anónima por interés público y
              trazabilidad.
            </p>
          </Card>

          <Card>
            <h2 className="text-lg font-bold">6. Seguridad y conservación</h2>
            <p className="mt-2 text-flm-muted">
              Aplicamos medidas técnicas razonables: cifrado en tránsito,
              control de acceso por roles, sesiones con expiración y registros
              de auditoría. Conservamos tus datos mientras tu cuenta esté activa
              y por el tiempo necesario para cumplir obligaciones legales.
            </p>
          </Card>

          <Card>
            <h2 className="text-lg font-bold">7. Cambios a esta política</h2>
            <p className="mt-2 text-flm-muted">
              Si cambiamos esta política de forma relevante, lo informaremos en
              la plataforma antes de que los cambios entren en vigencia.
            </p>
          </Card>
        </div>
      </div>
    </div>
  );
}
