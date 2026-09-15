# Falta la Muni (FLM)

Plataforma GovTech chilena donde los vecinos reportan problemas urbanos de su comuna y siguen, con evidencia pública, qué hizo la institución responsable — hasta que **la propia ciudadanía verifica** que el problema se solucionó. Ninguna municipalidad puede auto-declararse exitosa: el techo institucional está codificado en la máquina de estados.

Stack: Next.js 14 (App Router) · TypeScript estricto · Tailwind · PWA · MapLibre GL JS · Vitest.

## Instalación

```bash
npm i
cp .env.example .env.local   # completa FLM_SESSION_SECRET (mínimo 32 chars aleatorios)
npm run seed                 # datos y usuarios demo (provee el equipo dominio-datos)
npm run dev                  # http://localhost:3000
```

## Configuración

Variables en `.env.example` (sin valores reales):

| Variable | Descripción |
|---|---|
| `FLM_SESSION_SECRET` | Firma HMAC de sesiones. **Obligatorio en producción** (`NODE_ENV=production` lanza si falta). |
| `FLM_DATA_DIR` | Directorio de `db.json` del adaptador demo (default `./.data`). |
| `NEXT_PUBLIC_APP_URL` | URL pública de la app. |
| `NEXT_PUBLIC_MAP_TILES_URL` / `NEXT_PUBLIC_MAP_ATTRIBUTION` | Tiles del mapa (MapLibre). |
| `FLM_DEMO_MODE` | `true` = datos y usuarios demo etiquetados. En producción: `false`. |
| `FLM_SESSION_SLIDING` | `true` = expiración deslizante de sesiones (default `false`). |

## Migraciones

**No hay.** El MVP usa un adaptador demo que persiste en un JSON local (`FLM_DATA_DIR/db.json`, escritura atómica, schemaless). La ruta de migración a Supabase/PostGIS está documentada en `docs/ARCHITECTURE.md` y mantiene los contratos de `lib/domain`.

## Seed

`npm run seed` carga categorías, municipalidad demo, reportes de ejemplo y los usuarios demo de la tabla siguiente (script provisto por el equipo dominio-datos).

## Tests

```bash
npm test            # vitest run — todos los tests
npm run typecheck   # tsc --noEmit
```

Cobertura del equipo seguridad-qa-docs: `lib/auth/__tests__/auth.test.ts` (scrypt, firma HMAC, expiración, sesiones), `lib/__tests__/rate-limit.test.ts`, `lib/__tests__/security.test.ts` (sanitize, magic bytes, safeRedirect). Contratos API de seguridad como `describe.skip` hasta que existan los handlers (`lib/__tests__/api-security-contracts.test.ts`). Detalle y los 12 recorridos E2E en `docs/TESTING.md`.

## Despliegue

```bash
npm i && npm run seed && npm run build && npm start
```

Ver `docs/DEPLOYMENT.md` (variables, Vercel + Supabase futuro, limitaciones multi-instancia del adaptador demo).

## Usuarios demo

Todos con password **`Demo1234!`** (solo con `FLM_DEMO_MODE=true`; nunca en producción):

| Email | Rol | Uso |
|---|---|---|
| `vecina@demo.flm.cl` | RESIDENT | Reportar, confirmar, verificar |
| `vecina.verificada@demo.flm.cl` | VERIFIED_RESIDENT | Verificación con mayor peso |
| `funcionario@demo.flm.cl` | MUNICIPAL_AGENT | Gestionar reportes de la comuna demo |
| `jefatura@demo.flm.cl` | MUNICIPAL_MANAGER | Derivar, gestionar miembros, exportar |
| `agencia@demo.flm.cl` | EXTERNAL_AGENCY_AGENT | Atender derivaciones |
| `moderacion@demo.flm.cl` | INDEPENDENT_MODERATOR | Moderar con fundamento público |
| `admin@demo.flm.cl` | PLATFORM_ADMIN | Operación de plataforma |

## Limitaciones reales del MVP

- **Un solo proceso**: sesiones y rate limit en memoria/disco local; con 2+ réplicas no se comparten (ver `docs/DEPLOYMENT.md`).
- **Fotos como dataURL validados** (magic bytes + 5 MB); en producción van a Storage con URLs firmadas.
- **Sin Playwright**: E2E cubiertos a nivel servicios + handlers.
- `FLM_DEMO_MODE=true` expone datos ficticios claramente etiquetados: jamás en producción.
- El service worker nunca cachea `/api` ni datos privados.

## Documentación

En `docs/`: `PRODUCT.md` · `ARCHITECTURE.md` · `DATA_MODEL.md` · `STATE_MACHINE.md` · `PERMISSIONS.md` · `INDEPENDENCE_AND_GOVERNANCE.md` · `PRIVACY_AND_SECURITY.md` · `MUNICIPAL_BUSINESS_MODEL.md` · `DEPLOYMENT.md` · `TESTING.md` · `DECISIONS.md`.
