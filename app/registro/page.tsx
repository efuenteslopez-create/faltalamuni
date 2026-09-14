import type { Metadata } from "next";
import { RegisterForm } from "@/components/citizen/RegisterForm";

export const metadata: Metadata = {
  title: "Crear cuenta",
  description: "Crea tu cuenta gratuita en Falta la Muni y empieza a mejorar tu comuna.",
};

export default function RegistroPage() {
  return <RegisterForm />;
}
