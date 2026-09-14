/**
 * FLM — Esquemas Zod compartidos (spec §11).
 * Toda mutación sensible se valida en servidor con estos esquemas.
 */
import { z } from "zod";
import { REPORT_STATES, ROLES } from "@/lib/domain/types";

export const uuidSchema = z.string().uuid();

/**
 * Identificadores del demo (slugs fijos como "mun-pudahuel", "cat-basural").
 * Se acepta cualquier string no vacío; los UUID siguen siendo válidos.
 */
export const idSchema = z.string().min(1).max(80);

export const geoPointSchema = z.object({
  lng: z.number().min(-180).max(180),
  lat: z.number().min(-90).max(90),
});

export const reportCreateSchema = z.object({
  categoryId: idSchema,
  municipalityId: idSchema.optional(),
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

/** Filtros de GET /api/reports. */
export const reportListQuerySchema = z.object({
  state: z.enum(REPORT_STATES as [string, ...string[]]).optional(),
  categoryId: idSchema.optional(),
  municipalityId: idSchema.optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
  lat: z.coerce.number().min(-90).max(90).optional(),
  radiusM: z.coerce.number().int().min(10).max(50000).default(1000).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

/** GET /api/duplicates?lng=&lat=&categoryId= */
export const duplicatesQuerySchema = z.object({
  lng: z.coerce.number().min(-180).max(180),
  lat: z.coerce.number().min(-90).max(90),
  categoryId: idSchema,
  radiusM: z.coerce.number().int().min(10).max(5000).default(100).optional(),
});

export const evidenceJsonSchema = z.object({
  dataUrl: z.string().max(8_000_000),
  description: z.string().trim().max(500).optional(),
  kind: z.enum(["problem", "solution"]).default("solution"),
  idempotencyKey: uuidSchema.optional(),
});

export const publicResponseSchema = z.object({
  message: z.string().trim().min(1).max(2000),
  idempotencyKey: uuidSchema.optional(),
});

export const internalNoteSchema = z.object({
  message: z.string().trim().min(1).max(2000),
  idempotencyKey: uuidSchema.optional(),
});

export const assignmentSchema = z.object({
  departmentId: idSchema,
  expectedVersion: z.number().int().min(1),
  idempotencyKey: uuidSchema.optional(),
});

export const referralSchema = z.object({
  agencyId: idSchema,
  reason: z.string().trim().min(5).max(2000),
  expectedVersion: z.number().int().min(1),
  idempotencyKey: uuidSchema.optional(),
});

export const inboxQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const exportQuerySchema = z.object({
  municipalityId: idSchema.optional(),
});

export function formatZodError(error: z.ZodError): string {
  return error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
}
