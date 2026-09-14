/**
 * FLM — Esquemas Zod compartidos (spec §11).
 * Toda mutación sensible se valida en servidor con estos esquemas.
 */
import { z } from "zod";
import { REPORT_STATES, ROLES } from "@/lib/domain/types";

export const uuidSchema = z.string().uuid();

export const geoPointSchema = z.object({
  lng: z.number().min(-180).max(180),
  lat: z.number().min(-90).max(90),
});

export const reportCreateSchema = z.object({
  categoryId: uuidSchema,
  title: z.string().trim().min(5).max(120),
  description: z.string().trim().min(10).max(2000),
  location: geoPointSchema,
  anonymousPublic: z.boolean().default(false),
  // Foto: en el MVP demo se acepta dataURL o URL ya subida; validación real de
  // contenido en el handler (magic bytes + límite de tamaño).
  photoDataUrl: z.string().max(8_000_000).optional(),
  idempotencyKey: uuidSchema.optional(),
});

export const reportTransitionSchema = z.object({
  to: z.enum(REPORT_STATES as [string, ...string[]]),
  reason: z.string().trim().max(2000).optional(),
  expectedVersion: z.number().int().min(1),
  idempotencyKey: uuidSchema.optional(),
});

export const confirmationSchema = z.object({
  idempotencyKey: uuidSchema.optional(),
});

export const verificationVoteSchema = z.object({
  approve: z.boolean(),
  comment: z.string().trim().max(1000).optional(),
  idempotencyKey: uuidSchema.optional(),
});

export const loginSchema = z.object({
  email: z.string().email().max(160),
  password: z.string().min(1).max(256),
});

export const registerSchema = z.object({
  email: z.string().email().max(160),
  password: z.string().min(8).max(256),
  displayName: z.string().trim().min(2).max(80),
});

export const roleSchema = z.enum(ROLES as [string, ...string[]]);

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export function formatZodError(error: z.ZodError): string {
  return error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
}
