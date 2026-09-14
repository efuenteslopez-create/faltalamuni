import type { Metadata } from "next";
import { ReportWizard } from "@/components/citizen/ReportWizard";

export const metadata: Metadata = {
  title: "Reportar un problema",
  description: "Reporta un problema urbano de tu comuna en 5 simples pasos.",
};

export default function ReportarPage() {
  return (
    <div className="flm-container py-6">
      <ReportWizard />
    </div>
  );
}
