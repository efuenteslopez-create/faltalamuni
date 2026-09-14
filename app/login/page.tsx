import { Suspense } from "react";
import type { Metadata } from "next";
import { LoginForm } from "@/components/citizen/LoginForm";

export const metadata: Metadata = {
  title: "Entrar",
  description: "Inicia sesión en Falta la Muni para reportar y seguir problemas de tu comuna.",
};

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
