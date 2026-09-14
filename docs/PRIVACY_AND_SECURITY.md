# FLM — Privacidad y seguridad

## Privacidad

### Fotos: EXIF stripping en el cliente (vía canvas)
Antes de subir una foto, el cliente la redibuja en un `<canvas>` y exporta el resultado. El redibujado **descarta los metadatos EXIF** (GPS, modelo del teléfono, fecha de captura), por lo que la ubicación exacta del domicilio de quien reporta nunca viaja al servidor. En el servidor, además, `isValidImageDataUrl` (`lib/security.ts`) valida magic bytes PNG/JPEG/WEBP y un tope de 5 MB.

### Coordenadas sensibles aproximadas
Las categorías marcadas `sensitiveLocation` (ej. las que típicamente se reportan desde el domicilio) exponen públicamente solo `publicLocation`: el punto exacto desplazado a una grilla de ~150 m (`approximatePublicLocation` en `lib/domain/geo.ts`). La ubicación exacta (`location`) queda con acceso restringido por rol y comuna. En la migración a PostGIS ambas serán `geography(Point, 4326)`; la aproximación se mantiene en la capa de servicio.

### URLs firmadas en producción
En el MVP demo las fotos viajan como dataURL validados. En producción irán a Supabase Storage y se servirán con **URLs firmadas de corta duración**, nunca con URLs públicas permanentes ni predecibles.

### Ley 19.628 (Chile)
- **Finalidad**: los datos personales (email, ubicación exacta) se usan solo para operar la plataforma; no se venden ni se comparten con terceros con fines distintos.
- **Consentimiento**: el registro informa qué datos se recogen y para qué; el reporte puede ser `anonymousPublic` (la autoría no se muestra públicamente).
- **Derechos ARCO**: la vecina puede pedir acceso, rectificación y eliminación de sus datos personales. La eliminación usa **tombstones**: el dato personal se borra, pero los eventos de auditoría conservan un marcador anonimizado (sin PII) para no romper la trazabilidad pública.
- **Medidas de seguridad**: hash scrypt con sal única, sesiones firmadas HMAC-SHA256, cookies httpOnly + `SameSite=Lax` (+ `Secure` en producción), rate limiting en login, validación Zod en servidor.

### Retención y tombstones
- Los reportes ciudadanos son historia pública y **no se borran** (son el registro de la gestión municipal).
- Los datos personales (email, ubicación exacta, fotos con personas identificables a pedido) se pueden eliminar vía tombstone: se reemplazan por un marcador `deleted:true` + fecha, manteniendo la integridad referencial y la auditoría sin PII.
- Las sesiones expiradas se destruyen al detectarse; hay un tope de 10 sesiones activas por usuario.

## Seguridad

| Capa | Medida |
|---|---|
| Transporte | `Secure` en cookies (prod), `Strict-Transport-Security` recomendado en el deploy |
| Sesiones | Cookie httpOnly firmada HMAC-SHA256 (`flm_session`); `FLM_SESSION_SECRET` obligatorio en prod (sin fallback); expiración 14 días, deslizante opt-in (`FLM_SESSION_SLIDING`) |
| Passwords | scrypt (sal 16 bytes, 64 bytes derivados), comparación `timingSafeEqual`, mínimo 8 caracteres (schema + servicio) |
| Entrada | Zod en servidor para toda mutación; `sanitizeText` (trim, colapso de espacios, sin control chars, tope); `safeRedirect` anti open-redirect en `?next=` |
| Archivos | Magic bytes reales + 5 MB en servidor; EXIF strip en cliente |
| Abuso | Rate limit token-bucket en memoria (migrar a Redis en multi-instancia); claves de idempotencia en mutaciones críticas |
| Cabeceras | `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy` (cámara/geolocalización solo self) en `next.config.mjs` |
| Rutas | `middleware.ts` redirige `/panel/**` y `/perfil/**` sin sesión a `/login?next=…`; el rol lo valida cada página/API |
| PWA | El service worker **nunca cachea `/api`** ni datos privados |
| Auditoría | Append-only (`lib/audit.ts`): quién hizo qué, cuándo, sobre qué |

## Lo que el MVP NO garantiza (honestidad técnica)

- El rate limit y las sesiones viven **en memoria / en un JSON local**: en un deploy multi-instancia (dos dynos, dos réplicas) no se comparten. Ver `docs/DEPLOYMENT.md`.
- El fallback de `FLM_SESSION_SECRET` en desarrollo **nunca** debe usarse en producción (`NODE_ENV=production` lanza si falta).
- `FLM_DEMO_MODE=true` activa datos y usuarios de demostración claramente etiquetados: en producción debe ser `false`.
