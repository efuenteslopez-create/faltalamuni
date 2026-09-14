import type { Metadata } from "next";
import { ReportDetail } from "@/components/citizen/ReportDetail";

export const metadata: Metadata = {
  title: "Detalle del reporte",
  description: "Sigue el estado de un reporte ciudadano en Falta la Muni.",
};

export default function ReportPage({ params }: { params: { code: string } }) {
  return <ReportDetail code={params.code} />;
}
