import type {
  FieldErrors,
  FieldValues,
  Resolver,
  ResolverResult,
} from "react-hook-form";
import type { z } from "zod";

/**
 * Resolvedor mínimo de Zod para React Hook Form.
 * Evita sumar la dependencia @hookform/resolvers para un solo uso.
 */
export function zodResolver<TFieldValues extends FieldValues>(
  schema: z.ZodType<TFieldValues>
): Resolver<TFieldValues> {
  const run = async (
    values: TFieldValues
  ): Promise<ResolverResult<TFieldValues>> => {
    const parsed = schema.safeParse(values);
    if (parsed.success) {
      return { values: parsed.data, errors: {} };
    }
    const errors: Record<string, { type: string; message: string }> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path.join(".");
      if (key && !errors[key]) {
        errors[key] = { type: issue.code, message: issue.message };
      }
    }
    return {
      values: {},
      errors: errors as FieldErrors<TFieldValues>,
    };
  };
  return run;
}
