import type { Metadata } from "next";
import Link from "next/link";
import { Card } from "@/components/ui/primitives";

export const metadata: Metadata = {
  title: "Para municipios",
  description:
    "Falta la Muni para municipios: consolidación, georreferenciación, enrutamiento, trazabilidad y analítica de reportes ciudadanos.",
};

const CONTACT = "contacto@faltalamuni.cl";

const CAPABILITIES = [
  {
    title: "Consolidación",
    body: "Todos los reportes ciudadanos de tu comuna en una sola bandeja operativa, con estados claros y responsables asignados.",
  },
  {
    title: "Georreferenciación",
    body: "Cada reporte ubicado en el mapa, con mapa de calor por sectores para priorizar cuadrillas y operativos.",
  },
  {
    title: "Detección de duplicados",
    body: "Reportes sobre el mismo problema se agrupan para no dispersar la gestión ni duplicar visitas a terreno.",
  },
  {
    title: "Enrutamiento inteligente",
    body: "Clasificación por responsable directo: lo municipal va al departamento que corresponde; lo demás se deriva con fundamento a SERVIU, MOP o empresas de servicios.",
  },
  {
    title: "Trazabilidad total",
    body: "Historial auditable de cada caso: quién actuó, cuándo y con qué fundamento. Control de versiones ante ediciones concurrentes.",
  },
  {
    title: "Evidencia antes/después",
    body: "Registro fotográfico del trabajo realizado, requisito para informar una solución y base para la verificación ciudadana.",
  },
  {
    title: "Analítica objetiva",
    body: "Tiempos de respuesta, gestión por departamento y soluciones verificadas, calculados por la plataforma con metodología pública.",
  },
  {
    title: "Independencia garantizada",
    body: "Tu equipo gestiona y responde, pero no edita reportes ni se auto-verifica. Eso protege a la institución tanto como a los vecinos.",
  },
];

/**
 * Propuesta B2G sobria: qué resuelve, planes, piloto de 90 días y contacto.
 */
export default function MunicipiosPage() {
  return (
    <div className="min-h-screen bg-flm-bg">
      <div className="flm-container max-w-4xl py-8">
        <Link href="/" className="text-sm font-semibold text-flm-institutional underline">
          ← Volver al inicio
        </Link>

        <h1 className="mt-3 text-3xl font-extrabold text-flm-ink">
          Falta la Muni para municipios
        </h1>
        <p className="mt-3 max-w-2xl text-lg text-flm-muted">
          Los reportes ciudadanos ya existen: están en redes sociales, en
          llamados y en papeles. Nosotros los convertimos en gestión medible,
          con trazabilidad completa y verificación independiente.
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          <a
            href={`mailto:${CONTACT}?subject=Piloto%2090%20d%C3%ADas%20%E2%80%94%20Falta%20la%20Muni`}
            className="flm-btn-primary"
          >
            Solicitar piloto de 90 días
          </a>
          <Link href="/transparencia" className="flm-btn-secondary">
            Cómo garantizamos independencia
          </Link>
        </div>

        <h2 className="mt-10 text-xl font-extrabold text-flm-ink">
          Qué incluye la plataforma
        </h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {CAPABILITIES.map((c) => (
            <Card key={c.title}>
              <h3 className="font-bold text-flm-ink">{c.title}</h3>
              <p className="mt-1.5 text-sm text-flm-muted">{c.body}</p>
            </Card>
          ))}
        </div>

        <h2 className="mt-10 text-xl font-extrabold text-flm-ink">Planes</h2>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <Card className="flex flex-col">
            <h3 className="text-lg font-extrabold text-flm-ink">Comuna Conectada</h3>
            <p className="mt-1 text-sm text-flm-muted">
              Para partir: escucha activa y respuesta.
            </p>
            <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm text-flm-ink">
              <li>Bandeja operativa con estados y vencimientos</li>
              <li>Mapa de calor y georreferenciación</li>
              <li>Respuestas públicas y derivaciones fundadas</li>
              <li>Indicadores básicos con metodología pública</li>
              <li>Hasta 5 cuentas funcionarias</li>
            </ul>
            <a
              href={`mailto:${CONTACT}?subject=Plan%20Comuna%20Conectada`}
              className="flm-btn-secondary mt-5"
            >
              Cotizar Comuna Conectada
            </a>
          </Card>
          <Card className="flex flex-col border-2 border-flm-accent">
            <h3 className="text-lg font-extrabold text-flm-ink">Gestión Avanzada</h3>
            <p className="mt-1 text-sm text-flm-muted">
              Para operar a escala, con datos para decidir.
            </p>
            <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm text-flm-ink">
              <li>Todo lo de Comuna Conectada</li>
              <li>Enrutamiento por departamento y detección de duplicados</li>
              <li>Notas internas y coordinación de cuadrillas</li>
              <li>Analítica por departamento y categoría</li>
              <li>Exportación CSV y tarjetas comunicacionales</li>
              <li>Cuentas funcionarias ilimitadas y roles de gestión</li>
            </ul>
            <a
              href={`mailto:${CONTACT}?subject=Plan%20Gesti%C3%B3n%20Avanzada`}
              className="flm-btn-primary mt-5"
            >
              Cotizar Gestión Avanzada
            </a>
          </Card>
        </div>

        <Card className="mt-6">
          <h2 className="text-lg font-extrabold text-flm-ink">
            Piloto de 90 días
          </h2>
          <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-flm-ink">
            <li>
              <strong>Semanas 1–2 · Puesta en marcha:</strong> configuramos tu
              comuna, departamentos y cuentas funcionarias. Capacitación de 2
              horas a tu equipo.
            </li>
            <li>
              <strong>Semanas 3–10 · Operación:</strong> tu equipo gestiona
              reportes reales con acompañamiento semanal y reporte de avance.
            </li>
            <li>
              <strong>Semanas 11–12 · Evaluación:</strong> informe con
              indicadores antes/después y recomendación de continuidad. Sin
              compromiso de permanencia.
            </li>
          </ol>
          <a
            href={`mailto:${CONTACT}?subject=Piloto%2090%20d%C3%ADas%20%E2%80%94%20Falta%20la%20Muni`}
            className="flm-btn-primary mt-5"
          >
            Agendar conversación
          </a>
        </Card>

        <p className="mt-6 text-sm text-flm-muted">
          ¿Prefieres escribirnos directo?{" "}
          <a href={`mailto:${CONTACT}`} className="underline">
            {CONTACT}
          </a>
        </p>
      </div>
    </div>
  );
}
