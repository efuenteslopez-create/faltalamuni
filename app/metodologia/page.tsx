import type { Metadata } from "next";
import Link from "next/link";
import { Card } from "@/components/ui/primitives";

export const metadata: Metadata = {
  title: "Metodología",
  description:
    "Cómo calcula Falta la Muni cada indicador: fórmulas comprensibles y reglas públicas.",
};

const INDICATORS: Array<{
  name: string;
  formula: string;
  explanation: string;
}> = [
  {
    name: "% con respuesta institucional",
    formula: "reportes con primera respuesta ÷ reportes totales × 100",
    explanation:
      "Cuenta si la institución reconoció, clasificó o respondió el reporte al menos una vez. No mide calidad, solo que hubo respuesta.",
  },
  {
    name: "Mediana primera respuesta (horas)",
    formula: "mediana del tiempo entre publicación y primer evento institucional",
    explanation:
      "Usamos la mediana (no el promedio) para que unos pocos casos extremos no distorsionen el indicador. El “primer evento” es el reconocimiento, la clasificación o una respuesta pública.",
  },
  {
    name: "% en gestión",
    formula: "reportes en estado reconocido, clasificado, asignado, derivado o en terreno ÷ total × 100",
    explanation:
      "Mide cuántos reportes están activamente en manos de alguna institución, sin contar los ya cerrados ni los rechazados.",
  },
  {
    name: "% solución informada",
    formula: "reportes con solución informada ÷ total × 100",
    explanation:
      "La institución declaró que el problema está solucionado y adjuntó evidencia. Ojo: esto NO significa que esté verificado.",
  },
  {
    name: "% solucionados verificados",
    formula: "reportes verificados por la comunidad o verificación independiente ÷ total × 100",
    explanation:
      "El indicador más exigente: solo cuenta cuando alguien distinto de la institución confirma en terreno que el problema se resolvió.",
  },
  {
    name: "Mediana días a solución",
    formula: "mediana de días entre publicación y solución informada",
    explanation:
      "Cuánto tarda, típicamente, que un reporte pase de publicado a “solución informada”.",
  },
  {
    name: "Reabiertos",
    formula: "conteo de reportes que volvieron a abrirse tras una solución informada",
    explanation:
      "Si la comunidad considera insuficiente la solución, puede reabrir el caso con fundamento. Muchas reaperturas sugieren soluciones de baja calidad.",
  },
  {
    name: "Derivados",
    formula: "conteo de reportes derivados a agencias externas (SERVIU, MOP, empresas de servicios)",
    explanation:
      "No todo es responsabilidad municipal. Este indicador transparenta cuántos casos corresponden a otras instituciones.",
  },
  {
    name: "Crédito municipal",
    formula: "conteo de soluciones verificadas donde la gestión fue municipal",
    explanation:
      "Reconoce el trabajo bien hecho: cada vez que una gestión municipal termina en solución verificada, suma crédito público para la comuna.",
  },
];

/**
 * Metodología pública: cómo se calcula cada indicador, en lenguaje claro.
 */
export default function MetodologiaPage() {
  return (
    <div className="min-h-screen bg-flm-bg">
      <div className="flm-container max-w-3xl py-8">
        <Link href="/" className="text-sm font-semibold text-flm-institutional underline">
          ← Volver al inicio
        </Link>
        <h1 className="mt-3 text-3xl font-extrabold text-flm-ink">Metodología</h1>
        <p className="mt-2 text-flm-muted">
          Todos los indicadores de Falta la Muni se calculan con reglas
          públicas, sobre eventos auditables, y sin intervención de las
          municipalidades. Si una fórmula cambia, se versiona y se informa.
        </p>

        <div className="mt-6 space-y-4">
          {INDICATORS.map((ind) => (
            <Card key={ind.name}>
              <h2 className="text-lg font-bold text-flm-ink">{ind.name}</h2>
              <p className="mt-2 rounded-lg bg-flm-bg p-3 font-mono text-sm text-flm-ink">
                {ind.formula}
              </p>
              <p className="mt-2 text-sm text-flm-muted">{ind.explanation}</p>
            </Card>
          ))}
        </div>

        <Card className="mt-6">
          <h2 className="text-lg font-bold text-flm-ink">Principios de cálculo</h2>
          <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm text-flm-muted">
            <li>
              Los indicadores se calculan sobre la historia de eventos, no sobre
              campos editables: no se pueden “maquillar”.
            </li>
            <li>
              La verificación de soluciones siempre es ciudadana o independiente;
              ninguna institución se auto-verifica.
            </li>
            <li>
              No publicamos rankings entre comunas: cada comuna se compara con
              su propio historial.
            </li>
            <li>
              Los datos personales se agregan y las ubicaciones sensibles se
              aproximan antes de publicarse.
            </li>
          </ul>
        </Card>
      </div>
    </div>
  );
}
