# FLM — Decisiones (equipo seguridad-qa-docs)

Registro numerado de decisiones tomadas ante especificación ambigua o restricciones reales. Si una decisión se revierte, se anota aquí sin borrar la original.

## D1. Sin Supabase por falta de credenciales → adaptador JSON
No había credenciales de Supabase disponibles. En vez de bloquear el MVP, se usa `lib/db/store.ts`: JSON con escritura atómica y cola de escritura, con interfaz (`transact`/`read`/`nextSequence`) diseñada para migrar a Supabase/PostGIS sin cambiar el resto del código. Nunca se finge que el JSON es Supabase: está declarado en `docs/ARCHITECTURE.md` y `docs/DEPLOYMENT.md`.

## D2. Fotos como dataURL en demo → Storage en producción
Sin bucket disponible, las fotos del MVP viajan como dataURL **validados en servidor** con magic bytes reales y tope de 5 MB (`lib/security.ts`). En producción van a Supabase Storage con URLs firmadas de corta duración. El límite Zod de 8M caracteres en el schema es solo pre-filtro; la validación real es por bytes decodificados.

## D3. Sin Playwright → E2E a nivel servicios + handlers
Sin UI estable ni tiempo para Playwright, los 12 recorridos E2E se cubren contra la lógica real de servicios y handlers (ver `docs/TESTING.md`). Los tests de contrato API quedan como `describe.skip` hasta que dominio-datos publique los handlers.

## D4. REPORTED → AWAITING_RESPONSE automático al publicar
La spec lista 13 estados pero no dice cómo se sale de `REPORTED`. Decisión: transición automática por `SYSTEM` en la misma transacción de creación. Representa "esperando respuesta institucional" sin requerir acción manual, y evita reportes estancados en un estado sin responsable.

## D5. El middleware solo verifica presencia de sesión, no rol
`middleware.ts` corre en Edge sin acceso al store de sesiones. Verificar el rol ahí exigiría llamar a la base de datos o confiar en un claim del cliente. Decisión: el middleware solo redirige a `/login?next=…` si no hay cookie; la validez de la sesión y el rol se verifican en cada página/API con `getAuth()`/`requireAuth()` + `permissions.ts`.

## D6. `SESSION_COOKIE` duplicado en `middleware.ts`
Importar `lib/auth/auth.ts` desde el middleware rompería el Edge runtime (`node:crypto`, `next/headers`). Decisión: duplicar solo el string `"flm_session"` con un comentario que obliga a mantenerlo sincronizado. Duplicación mínima y explícita antes que un import que rompe el build.

## D7. Expiración deslizante opt-in, desactivada por defecto
La spec no pedía sliding expiration. Se implementó como opt-in (`FLM_SESSION_SLIDING`, default `false`): con actividad y menos de la mitad del TTL restante, la sesión se extiende un período completo. Default desactivado porque cambia la semántica de expiración y en producción debe evaluarse conscientemente.

## D8. Tope de 10 sesiones activas por usuario
Sin límite, los dispositivos compartidos acumulan sesiones eternas. Al crear la sesión 11, se revocan las más antiguas. El número 10 es arbitrario pero razonable; es una constante exportada (`MAX_ACTIVE_SESSIONS`) para ajustarla sin tocar lógica.

## D9. Política de password ≥ 8 duplicada en el servicio
El schema Zod de registro ya exige mínimo 8, pero `createUser` es usado también por seed y futuros callers. Decisión: `assertPasswordPolicy` en el servicio como defensa en profundidad (código `WEAK_PASSWORD`). No rompe firmas.

## D10. `safeRedirect`: whitelist estricta de rutas internas
Ante `?next=` ambiguo, decisión conservadora: solo se acepta lo que empieza con `/`, sin `//`, sin `\` y sin caracteres de control. Todo lo demás → fallback `/`. Un falso negativo (redirigir al home en vez de a una ruta rara pero legítima) es preferible a un open-redirect.

## D11. `isValidImageDataUrl` retorna boolean y nunca lanza
Para usarla directo en handlers sin try/catch, cualquier entrada malformada (no-string, base64 roto, magic bytes falsos, sobre 5 MB) retorna `false`. La razón del rechazo se puede loguear en el handler si se necesita, pero el contrato es binario a propósito.

## D12. Errores `tsc` preexistentes de otros equipos no se tocan
`npx tsc --noEmit` reporta errores en `app/panel/_lib/api.ts`, `components/map/CitizenMapImpl.tsx` y `lib/flm/draft.ts` (equipo dominio-datos). Decisión: no editar archivos ajenos para "dejar el typecheck en verde"; se documenta la deuda en `docs/TESTING.md`. Ningún archivo de seguridad-qa-docs tiene errores de tipos.

## D13. Contratos API de seguridad como `describe.skip`
En vez de no escribir nada hasta que existan los handlers, se dejaron 8 tests skippeados con el plan exacto de aserciones (`lib/__tests__/api-security-contracts.test.ts`). Cuando dominio-datos publique `app/api/**`, se activan. Un skip explícito es mejor que un TODO en un comentario.

## D14. `sanitizeText` colapsa saltos de línea a espacios
La spec pide "colapsa espacios". Decisión: colapsar **toda** corrida de whitespace (incluidos `\n`, `\t`) a un solo espacio, además de trim, remoción de control chars y tope de largo. Se prioriza la seguridad de renderizado sobre preservar formato multilínea en campos saneados.

## D15. Normalización de email en el servicio, no solo en Zod
`createUser` y `findUserByEmail` normalizan (minúsculas + trim) y validan formato en la capa de servicio, independiente de que el handler valide con Zod. Evita duplicados lógicos (`Vecina@X.cl` vs `vecina@x.cl`) aunque algún caller futuro olvide el schema.

## D16. `scripts/seed.ts` referenciado pero provisto por dominio-datos
`package.json` define `npm run seed` y los docs lo citan como parte del flujo canónico, pero el script lo construye el equipo dominio-datos (aún no existe en el repo). Se documenta así en `README.md` y `docs/DEPLOYMENT.md` en vez de inventar un seed provisorio que diverja.

## D17. `INDEPENDENT_MODERATOR` no verifica soluciones
La matriz de permisos (dominio) no le da `report.verify` al moderador: quien modera no debería concentrar también el poder de declarar soluciones verificadas. La verificación queda en ciudadanía + `PLATFORM_ADMIN` como respaldo operativo.

## D18. Quórum de verificación configurable por entorno
`FLM_VERIFICATION_QUORUM` (default 3) en vez de constante hardcodeada: comunas chicas y grandes necesitan quórums distintos, y el piloto de 90 días puede requerir ajustarlo sin deploy de código.

## D19. Iteración 1: verificación independiente y crédito municipal causal (supersede D17/D18)

Auditoría del núcleo de confianza encontró tres hallazgos y se corrigieron así:

1. **Nadie verifica directo.** `AWAITING_VERIFICATION → VERIFIED_RESOLVED` solo la ejecuta el actor interno `SYSTEM` dentro de la transacción del voto que completa el quórum. Se eliminó `report.verify` de `PLATFORM_ADMIN` (D17 queda supersedida: el admin ya no es "respaldo operativo" de verificación). El esquema Zod de `/transitions` excluye `VERIFIED_RESOLVED` y el servicio la rechaza explícitamente con `FORBIDDEN` (defensa en profundidad, HTTP 403).
2. **Quórum ciudadano real.** Nueva función pura `evaluateVerificationQuorum` (`lib/domain/verification.ts`): vía A = autor que aprueba + al menos un `VERIFIED_RESIDENT` distinto; vía B = al menos tres `VERIFIED_RESIDENT` distintos. Residentes no verificados no cuentan; el autor pesa 1 como todos (se elimina el peso 2); cuentas vinculadas a la organización gestora/ejecutora no votan; la resolución queda auditada (`report.verification_resolved` con `via` y `approvingVoterIds`). D18 queda supersedida: `FLM_VERIFICATION_QUORUM` se retira de `.env.example`, `README.md`, `docs/DEPLOYMENT.md` y del código (no se leía en ningún lado); el quórum es fijo por regla, no configurable por entorno.
3. **Crédito municipal causal.** Nueva entidad `MunicipalAction` (`lib/domain/entities.ts`): solo organizaciones `kind === "MUNICIPALITY"` pueden registrar acciones acreditables (`POST /api/reports/[code]/municipal-actions`). El sello "Ya estuvo la Muni" exige: estado `VERIFIED_RESOLVED` + acción acreditable con `createdAt` anterior o igual al `SOLUTION_PROPOSED`. Reconocer, responder, asignar o derivar sin seguimiento NO generan crédito; verificado sin gestión muestra "Problema resuelto". El DTO público expone `attribution` estructurado (responsable, gestor, ejecutor, verificación, crédito con titular y explicación).

## D20. Iteración 1 (segunda tanda): timeline real, flujos de respaldo por API y atribución por ronda

Tres brechas detectadas en la auditoría de la iteración 1, cerradas así:

1. **Timeline público real.** `GET /api/reports/[code]/timeline` devuelve el arreglo real `TimelineItem[]` (unión discriminada compartida: `status | response | evidence | vote | municipal-action`). Se eliminó el contrato ficticio `{ events, responses, votes }` de `lib/flm/api.ts`: `api.timeline` devuelve `Promise<TimelineItem[]>`. El renderizado se unificó en `components/timeline/TimelineList.tsx`, usado por la vista ciudadana y por el historial institucional del panel. Para `municipal-action` se muestran tipo, municipalidad, descripción, fecha, estado de acreditación y respaldo; las referencias URL se renderizan como enlaces seguros (solo http/https, `target="_blank"`, `rel="noopener noreferrer"`); documentos/registros muestran su folio como texto; las notas internas nunca forman parte del contrato ni del render.
2. **Flujos de respaldo por API.** `registerPublicReference` y `recordReferralAcceptance` ya existían como servicios sin ruta; ahora se exponen:
   - `POST /api/reports/[code]/public-references` — body: `{ kind: "document"|"url"|"registry", reference, summary }`. Solo una organización `MUNICIPALITY` válida y correspondiente al reporte (gestora o municipalidad de la comuna).
   - `POST /api/reports/[code]/referral-acceptances` — body: `{ referralId, accepted, message }`. Solo la agencia receptora de esa derivación (una municipalidad no puede fabricar la aceptación; una agencia distinta tampoco).
   - Esquemas Zod estrictos (rechazan `organizationId`, `actorId`, `accredited`, `createdAt` y roles desde el cliente), autenticación por sesión, permisos y alcance organizacional, rate limiting, idempotencia y contrato de errores estándar. Sin formularios institucionales todavía: los flujos son utilizables vía API.
3. **Atribución vinculada a la ronda que resolvió.** El evento `report.verification_resolved` persiste explícitamente `verificationRequestId`, `via` y `approvingVoterIds`. `buildAttribution` obtiene la ronda vigente vía `resolvingRound` y localiza el evento de resolución que coincide con esa ronda; jamás usa "el primer auditEvent encontrado" (fallback separado y explícito solo para datos históricos anteriores a `verificationRequestId`). El DTO muestra vía, cantidad de aprobaciones y fecha de la resolución vigente. Los ítems `vote` del timeline incluyen `verificationRequestId`, `roundNumber` (1-based) y `currentRound`, para no mezclar visualmente verificaciones anteriores con la actual.

## D21. Iteración 2: hardening de auditoría — idempotencia concurrente, sanitización de imágenes, cadena tamper-evident y contratos de seguridad activados

1. **Next 16 / React 19.** Upgrade `next` 14 → 16.3.5, `react`/`react-dom` 19.3.0, `eslint-config-next` 16.3.5, flat config en `eslint.config.mjs`, `middleware.ts` → `proxy.ts`, Route Handlers y páginas dinámicas con `params: Promise<…>`, `cookies()`/`requireActor(req)` async. Seis falsos positivos de la regla React 19 de callbacks async se exceptúan localmente con justificación (solo cambian estado después de `await`); ninguna regla se deshabilita globalmente.
2. **Idempotencia con reclamo atómico.** `lib/idempotency.ts` + `withIdempotency` (`lib/api/http.ts`): identidad = clave + actor + método + ruta normalizada + SHA-256 del body canónico. Estados `PROCESSING`/`COMPLETED`/`FAILED`; reclamo atómico con `transact`; misma identidad concurrente → un líder ejecuta y los demás reciben el mismo status/body; misma clave con actor/ruta/método/body distintos → `409 IDEMPOTENCY_CONFLICT`; `PROCESSING` con TTL recuperable si el líder muere; `claimId` evita que un líder obsoleto pise un reclamo posterior; excepciones y respuestas `>=500` no se cachean. Garantía documentada como **monoproceso con el adaptador JSON**. Contrato requerido para Postgres: claim atómico mediante `UNIQUE(idempotency_key)` con `INSERT … ON CONFLICT` o bloqueo de fila.
3. **Sanitización de imágenes con Sharp.** `lib/services/media.ts`: límite de entrada 5 MB, decode real, solo PNG/JPEG/WEBP, `limitInputPixels` 16.777.216, máximo 4096 px por lado, auto-orientación EXIF (`.rotate()`), re-encode al formato real **sin** `.withMetadata()` (elimina EXIF/GPS/XMP/ICC y payload trailing), el MIME declarado debe coincidir con el contenido decodificado. `createReport` y `addEvidence` solo almacenan el dataURL sanitizado. Sharp pasó a `dependencies` (runtime). Nota de mapeo HTTP: `IMAGE_TOO_LARGE` → 400 (no 413); el plan original de contratos decía 413/422 para tamaño/transiciones, pero el mapeo real es 400 con código propio.
4. **Auditoría tamper-evident.** `AuditEvent` suma `previousHash` y `hash` (SHA-256 sobre representación canónica con claves ordenadas, incluyendo `previousHash`; génesis con `previousHash: null`). Construcción centralizada en `buildAuditEventTx` (`lib/audit.ts`): `audit()` y `auditTx()` usan el mismo constructor dentro de la transacción del llamador; `createdAt` se fuerza estrictamente creciente (+1 ms ante colisión). `verifyAuditChain` detecta detail/acción/actor alterados, eventos eliminados y reordenamientos. **Límites documentados**: tamper-evident ≠ tamper-proof (un atacante con escritura al archivo puede reescribir la cadena; no sustituye restricciones/almacenamiento en Postgres en producción). Los campos de auditoría (`actorId`, `action`) provienen siempre del servidor; ningún campo HTTP puede fabricarlos (test: login con `actorId`/`role` forjados en el body).
5. **Contratos de seguridad activados.** Los 8 `describe.skip` de `lib/__tests__/api-security-contracts.test.ts` (D13 queda supersedida) ahora ejercitan handlers reales: rate limit de login (429 + `Retry-After`) y no enumeración (401 idéntico); cookies `HttpOnly`/`SameSite=Lax` (`Secure` solo en producción) y token nunca en el body; Zod 400 + rechazo de mass assignment (`role`, `state`, `authorId`); 401 sin sesión / 403 sin capacidad; transiciones (regla inexistente → 400 `INVALID_TRANSITION`, techo institucional → 403, `expectedVersion` obsoleto → 409); `Idempotency-Key` (reintento idéntico, conflicto → 409); imágenes (magic bytes falsos → 400 `INVALID_IMAGE`, >5 MB → 400 `IMAGE_TOO_LARGE`); health sin secretos. Resultado: **cero skips en toda la suite**.
6. **Lenguaje de confianza.** "Respaldo verificado" → **"Respaldo público registrado"** en el timeline (y su variante negativa). Distingue: solución verificada por ciudadanía (sello "Ya estuvo la Muni", sin cambios), acción informada por municipalidad, y respaldo público registrado y consultable. "Verificado" se reserva para el quórum ciudadano.
7. **Límites multiinstancia documentados.** El rate limiter en memoria exige instancia única con JSON; en multiinstancia se requiere un limiter compartido (p. ej. Redis). La IP se extrae según la política explícita `FLM_TRUST_PROXY` (`lib/security/ip.ts`): sin confianza, `X-Forwarded-For` se ignora por completo.
