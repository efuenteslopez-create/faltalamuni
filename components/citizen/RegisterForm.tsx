"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "./zodResolver";
import { useAuth } from "@/lib/flm/auth";
import { friendlyErrorMessage } from "@/lib/flm/api";
import { Button, Card, Field, Input } from "@/components/ui/primitives";

const schema = z
  .object({
    displayName: z
      .string()
      .trim()
      .min(2, "Cuéntanos cómo te llamas (mínimo 2 caracteres).")
      .max(60, "Máximo 60 caracteres."),
    email: z.string().trim().min(1, "Ingresa tu correo.").email("Ese correo no parece válido."),
    password: z
      .string()
      .min(8, "La contraseña necesita al menos 8 caracteres.")
      .max(72, "Máximo 72 caracteres."),
    confirmPassword: z.string().min(1, "Repite tu contraseña."),
  })
  .refine((v) => v.password === v.confirmPassword, {
    message: "Las contraseñas no coinciden.",
    path: ["confirmPassword"],
  });

type FormValues = z.infer<typeof schema>;

/** Crear cuenta de vecino/a. */
export function RegisterForm() {
  const router = useRouter();
  const { register: signUp } = useAuth();
  const [submitError, setSubmitError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  async function onSubmit(values: FormValues) {
    setSubmitError(null);
    try {
      await signUp(values.email, values.password, values.displayName);
      router.push("/perfil");
      router.refresh();
    } catch (err) {
      setSubmitError(
        err instanceof Error && (err as { status?: number }).status === 409
          ? "Ese correo ya está registrado. Prueba entrando a tu cuenta."
          : friendlyErrorMessage(err)
      );
    }
  }

  return (
    <div className="flm-container flex min-h-[70vh] items-center justify-center py-10">
      <Card className="w-full max-w-md">
        <h1 className="text-2xl font-extrabold text-flm-ink">Crear cuenta</h1>
        <p className="mt-1 text-sm text-flm-muted">
          Únete a los vecinos que ya están mejorando su comuna.
        </p>
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="mt-6">
          <Field label="¿Cómo te llamas?" htmlFor="reg-name" error={errors.displayName?.message}>
            <Input
              id="reg-name"
              type="text"
              autoComplete="name"
              placeholder="Ej: Camila Rojas"
              {...register("displayName")}
            />
          </Field>
          <Field label="Correo electrónico" htmlFor="reg-email" error={errors.email?.message}>
            <Input
              id="reg-email"
              type="email"
              autoComplete="email"
              placeholder="tu@correo.cl"
              {...register("email")}
            />
          </Field>
          <Field label="Contraseña" htmlFor="reg-password" error={errors.password?.message}>
            <Input
              id="reg-password"
              type="password"
              autoComplete="new-password"
              placeholder="Mínimo 8 caracteres"
              {...register("password")}
            />
          </Field>
          <Field label="Repite tu contraseña" htmlFor="reg-confirm" error={errors.confirmPassword?.message}>
            <Input
              id="reg-confirm"
              type="password"
              autoComplete="new-password"
              {...register("confirmPassword")}
            />
          </Field>
          {submitError && (
            <p role="alert" className="mb-4 rounded-xl bg-red-50 p-3 text-sm font-medium text-flm-pending">
              {submitError}
            </p>
          )}
          <Button type="submit" disabled={isSubmitting} className="w-full">
            {isSubmitting ? "Creando tu cuenta…" : "Crear cuenta"}
          </Button>
        </form>
        <p className="mt-5 text-center text-sm text-flm-muted">
          ¿Ya tienes cuenta?{" "}
          <Link href="/login" className="font-bold text-flm-accent hover:underline">
            Entra aquí
          </Link>
        </p>
      </Card>
    </div>
  );
}
