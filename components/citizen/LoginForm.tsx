"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "./zodResolver";
import { useAuth } from "@/lib/flm/auth";
import { friendlyErrorMessage } from "@/lib/flm/api";
import { Button, Card, Field, Input } from "@/components/ui/primitives";

const schema = z.object({
  email: z.string().trim().min(1, "Ingresa tu correo.").email("Ese correo no parece válido."),
  password: z.string().min(1, "Ingresa tu contraseña."),
});

type FormValues = z.infer<typeof schema>;

/** Iniciar sesión. */
export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { login } = useAuth();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const next = searchParams.get("next") ?? "/perfil";

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  async function onSubmit(values: FormValues) {
    setSubmitError(null);
    try {
      await login(values.email, values.password);
      router.push(next);
      router.refresh();
    } catch (err) {
      setSubmitError(
        err instanceof Error && (err as { status?: number }).status === 401
          ? "Correo o contraseña incorrectos. Inténtalo de nuevo."
          : friendlyErrorMessage(err)
      );
    }
  }

  return (
    <div className="flm-container flex min-h-[70vh] items-center justify-center py-10">
      <Card className="w-full max-w-md">
        <h1 className="text-2xl font-extrabold text-flm-ink">Entrar</h1>
        <p className="mt-1 text-sm text-flm-muted">
          Bienvenido de vuelta a tu comuna.
        </p>
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="mt-6">
          <Field label="Correo electrónico" htmlFor="login-email" error={errors.email?.message}>
            <Input
              id="login-email"
              type="email"
              autoComplete="email"
              placeholder="tu@correo.cl"
              {...register("email")}
            />
          </Field>
          <Field label="Contraseña" htmlFor="login-password" error={errors.password?.message}>
            <Input
              id="login-password"
              type="password"
              autoComplete="current-password"
              {...register("password")}
            />
          </Field>
          {submitError && (
            <p role="alert" className="mb-4 rounded-xl bg-red-50 p-3 text-sm font-medium text-flm-pending">
              {submitError}
            </p>
          )}
          <Button type="submit" disabled={isSubmitting} className="w-full">
            {isSubmitting ? "Entrando…" : "Entrar"}
          </Button>
        </form>
        <p className="mt-5 text-center text-sm text-flm-muted">
          ¿No tienes cuenta?{" "}
          <Link href="/registro" className="font-bold text-flm-accent hover:underline">
            Regístrate gratis
          </Link>
        </p>
        <p className="mt-3 rounded-xl bg-flm-bg p-3 text-center text-xs text-flm-muted">
          ¿Quieres probar? Hay cuentas demo disponibles para explorar la plataforma.
        </p>
      </Card>
    </div>
  );
}
