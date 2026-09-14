/**
 * Banner de independencia: visible en todo el panel institucional.
 * Principio no negociable (spec §2): la plataforma es independiente de las
 * municipalidades; los reportes ciudadanos son inmutables para las instituciones.
 */
export function IndependenceBanner() {
  return (
    <div
      role="note"
      aria-label="Principio de independencia"
      className="border-b border-flm-institutional/25 bg-blue-50"
    >
      <div className="flm-container flex items-start gap-3 py-3">
        <svg
          viewBox="0 0 20 20"
          className="mt-0.5 h-5 w-5 shrink-0 text-flm-institutional"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          aria-hidden
        >
          <path
            d="M10 2l7 3v5c0 4.5-3 7.5-7 8-4-.5-7-3.5-7-8V5l7-3z"
            strokeLinejoin="round"
          />
          <path d="M7 10l2 2 4-4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <p className="text-sm leading-snug text-flm-ink">
          <strong className="font-bold">Independencia garantizada.</strong>{" "}
          Las instituciones pueden responder y gestionar reportes, pero no
          editarlos, eliminarlos ni verificar unilateralmente su solución.
        </p>
      </div>
    </div>
  );
}
