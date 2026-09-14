import { Card } from "@/components/ui/primitives";

/** Tarjeta de métrica: valor grande + etiqueta + contexto opcional. */
export function MetricCard({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: string;
  hint?: string;
  accent?: "ok" | "warn" | "bad" | "info";
}) {
  const accentClass =
    accent === "ok"
      ? "text-flm-verified"
      : accent === "warn"
        ? "text-flm-progress"
        : accent === "bad"
          ? "text-flm-pending"
          : accent === "info"
            ? "text-flm-institutional"
            : "text-flm-ink";
  return (
    <Card className="flex flex-col justify-between">
      <p className="text-sm font-semibold text-flm-muted">{label}</p>
      <p className={`mt-2 text-3xl font-extrabold tabular-nums ${accentClass}`}>
        {value}
      </p>
      {hint && <p className="mt-1 text-xs text-flm-muted">{hint}</p>}
    </Card>
  );
}
