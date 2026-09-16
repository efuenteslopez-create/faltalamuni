/**
 * FLM — Configuración ESLint (flat config, Next 16).
 * `next lint` fue eliminado en Next 16; se usa el CLI de ESLint directamente
 * con los presets oficiales de Next.js.
 */
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  globalIgnores([".next/**", "node_modules/**", "out/**"]),
  ...nextVitals,
  ...nextTs,
]);
