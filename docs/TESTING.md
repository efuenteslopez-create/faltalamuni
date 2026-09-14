# FLM — Testing

## Cómo correr

```bash
npm test            # vitest run (todos los tests)
npx vitest run lib/auth        # solo auth
npx vitest run lib/__tests__   # solo seguridad/rate-limit
npm run typecheck   # tsc --noEmit
```

Los tests usan `FLM_DATA_DIR` temporal (directorios únicos en el OS tmp) más `__resetCache()` (store) y `__resetRateLimits()`: no tocan `./.data` ni se pisan entre archivos.

## Qué se testea (equipo seguridad-qa-docs)

| Suite | Archivo | Cubre |
|---|---|---|
| Auth | `lib/auth/__tests__/auth.test.ts` (23 tests) | scrypt hash/verify (formato, sal aleatoria, rechazos), firma HMAC válida/manipulada/malformada, revocación, expiración (destruye la sesión), expiración deslizante opt-in on/off, tope de 10 sesiones por usuario, `listSessions`, normalización/validación de email, política de password ≥ 8 |
| Rate limit | `lib/__tests__/rate-limit.test.ts` (6 tests) | permite hasta el límite, bloquea al exceder, `remaining`, reinicio de ventana (fake timers), independencia entre claves, defaults |
| Security | `lib/__tests__/security.test.ts` (13 tests) | `sanitizeText` (trim, colapso, control chars, tope, no-string), `isValidImageDataUrl` (PNG/JPEG/WEBP reales, magic bytes falsos, formatos prohibidos, malformadas, > 5 MB), `safeRedirect` (rutas internas ok; absolutas, `//`, backslash, control chars → fallback) |
| Contratos API | `lib/__tests__/api-security-contracts.test.ts` | **8 tests marcados `describe.skip`, pendientes de los handlers de dominio-datos**: rate limit en login sin enumeración de usuarios, cookie httpOnly/SameSite, validación Zod 400, 401/403, techo institucional, concurrencia optimista, idempotencia, magic bytes en servidor, `/health` sin info sensible |

Otros equipos cubren `lib/domain` (máquina de estados, permisos) en sus propios tests.

## Los 12 recorridos E2E y su cobertura

**Decisión documentada**: sin Playwright en el MVP. Los recorridos se cubren a nivel servicios + handlers (lógica real, sin navegador). Playwright queda como trabajo futuro cuando exista UI estable.

| # | Recorrido | Cobertura actual |
|---|---|---|
| 1 | Vecina se registra, inicia sesión y crea un reporte con foto | Servicio + pendiente handler (contrato API skip) |
| 2 | Otro vecino confirma el reporte ("yo también lo vi") y lo sigue | Pendiente handler (contrato API skip) |
| 3 | Funcionario acusa recibo, clasifica y asigna | State machine (dominio) + pendiente handler |
| 4 | Jefatura deriva a organismo externo con fundamento | State machine (dominio) + pendiente handler |
| 5 | Institución informa solución con evidencia → queda en verificación | State machine (dominio) + pendiente handler |
| 6 | **Techo institucional**: funcionario intenta auto-verificar y es rechazado | State machine: `FORBIDDEN_TRANSITION` (dominio) |
| 7 | Quórum de vecinos verifica la solución → "solucionado verificado" | Pendiente handler (contrato API skip) |
| 8 | Vecina reabre un caso mal resuelto con fundamento | State machine (dominio) + pendiente handler |
| 9 | Moderación independiente rechaza un reporte con fundamento público | State machine (dominio) + pendiente handler |
| 10 | Login con credenciales inválidas: rate limit + sin enumeración | Pendiente handler (contrato API skip) |
| 11 | Sesión expirada/manipulada no accede a `/panel` | Auth (firma, expiración) + middleware (presencia) |
| 12 | Reintento de mutación con misma `Idempotency-Key` no duplica | Pendiente handler (contrato API skip) |

## Deuda de testing conocida

- `npx tsc --noEmit` hoy reporta errores **preexistentes en archivos de otros equipos** (`app/panel/_lib/api.ts`, `components/map/CitizenMapImpl.tsx`, `lib/flm/draft.ts`); ningún archivo de seguridad-qa-docs tiene errores (ver `docs/DECISIONS.md` D12).
- Falta: tests de handlers HTTP reales cuando dominio-datos publique `app/api/**` (activar los `describe.skip`), y Playwright para los 12 recorridos con navegador.
