import type { Metadata } from "next";
import { ReportDetail } from "@/components/citizen/ReportDetail";

export const metadata: Metadata = {
  title: "Detalle del reporte",
  description: "Sigue el estado de un reporte ciudadano en Falta la Muni.",
};

export default async function ReportPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  return <ReportDetail code={code} />;
}
