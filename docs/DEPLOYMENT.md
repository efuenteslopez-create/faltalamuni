# FLM — Despliegue

## Hoy (MVP demo)

```bash
npm i
npm run seed     # datos y usuarios demo (provee el equipo dominio-datos)
npm run build
npm start
```

La app corre en `http://localhost:3000`. El adaptador demo persiste en `./.data/db.json` (configurable con `FLM_DATA_DIR`).

## Variables de entorno

Ver `.env.example` (sin valores reales; copiar a `.env.local`):

| Variable | Uso |
|---|---|
| `FLM_SESSION_SECRET` | Firma HMAC de sesiones. **Obligatorio en producción** (mínimo 32 caracteres aleatorios). En dev hay fallback documentado que `NODE_ENV=production` rechaza. |
| `FLM_DATA_DIR` | Dónde el adaptador demo guarda `db.json`. Default `./.data` (ignorado por git). |
| `NEXT_PUBLIC_APP_URL` | URL pública (links compartidos, Open Graph). |
| `NEXT_PUBLIC_MAP_TILES_URL` / `NEXT_PUBLIC_MAP_ATTRIBUTION` | Tiles MapLibre (XYZ/OSM o proveedor con key). |
| `FLM_DEMO_MODE` | `true` activa datos/usuarios demo etiquetados. **En producción debe ser `false`.** |
| `FLM_VERIFICATION_QUORUM` | Vecinos independientes para verificar una solución (default 3). |
| `FLM_SESSION_SLIDING` | `true` activa expiración deslizante de sesiones (default `false`). |

## Futuro: Vercel + Supabase

- **Vercel**: deploy estándar de Next.js 14. Definir todas las variables anteriores; `FLM_DEMO_MODE=false`.
- **Supabase**: Postgres + PostGIS (`geography(Point,4326)`), Auth y Storage con URLs firmadas, siguiendo la ruta de migración de `docs/ARCHITECTURE.md` sin cambiar los contratos de `lib/domain`.
- El rate limit en memoria se reemplaza por Redis/Upstash.

## Limitaciones reales del adaptador demo en multi-instancia

El adaptador JSON está diseñado para **un solo proceso**:

1. **Sesiones y rate limit en memoria/disco local**: con 2+ réplicas, una sesión creada en la réplica A no existe en la B (logout fantasma) y el rate limit se puede evadir rotando réplicas.
2. **Escrituras serializadas por proceso**: dos réplicas escribiendo `db.json` a la vez pueden pisarse (el rename atómico evita corrupción del archivo, pero no conflictos lógicos entre réplicas).
3. **`db.json` no es backup**: es un archivo local; sin snapshots se pierde con el disco.
4. **Sin migraciones**: "no hay migraciones" porque no hay esquema versionado; el JSON es schemaless y el código tolera colecciones faltantes.

Para cualquier uso con usuarios reales: migrar a Supabase antes de escalar horizontalmente.
