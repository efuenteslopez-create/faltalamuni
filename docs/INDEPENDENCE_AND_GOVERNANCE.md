# FLM — Independencia y gobernanza

FLM se juega su credibilidad en una promesa: **la municipalidad es contraparte, no dueña de la plataforma**. Si una municipalidad pudiera editar reportes, auto-verificar soluciones o moderar críticas en su contra, la plataforma sería un canal de relaciones públicas, no un mecanismo de rendición de cuentas. Estas garantías están codificadas, no solo declaradas.

## Garantías técnicas de independencia

1. **Techo institucional en la máquina de estados** — ningún rol humano puede transicionar a `VERIFIED_RESOLVED`: solo el actor interno `SYSTEM` tras el quórum ciudadano (`lib/domain/state-machine.ts`). Intentarlo retorna `FORBIDDEN`/`FORBIDDEN_TRANSITION` (HTTP 403).
2. **Inmutabilidad del reporte original** — `canEditOriginalReport()` retorna `false` para todos los roles (`lib/domain/permissions.ts`). La institución solo agrega respuestas y evidencia en entidades separadas.
3. **Moderación separada** — solo `INDEPENDENT_MODERATOR` y `PLATFORM_ADMIN` pueden rechazar/ocultar/restaurar, siempre con fundamento público obligatorio (`requiresReason`). Las municipalidades no tienen capacidades de moderación.
4. **Verificación ciudadana** — el quórum de vecinos (`lib/domain/verification.ts`: autor + un vecino verificado, o tres vecinos verificados) es el que cierra un caso; ningún rol humano —ni admin, ni moderador, ni funcionario— puede verificar directamente. Cualquier vecina puede reabrirlo con fundamento.
5. **Notas internas blindadas** — `canReadInternalNotes` excluye incluso al `PLATFORM_ADMIN` de leer notas internas de una organización ajena.
6. **Auditoría append-only** — `lib/audit.ts`: toda acción sensible genera un evento que no se puede borrar ni editar. Si alguien intenta algo indebido, queda registrado quién, cuándo y qué.
7. **Alcance por comuna** — `inScope()`: un funcionario no cruza a otra comuna; el admin global no gestiona reportes.

## Qué NO puede hacer una municipalidad (aunque quiera)

| Acción | Resultado técnico |
|---|---|
| Editar o borrar el texto/foto de un reporte ciudadano | Imposible: `canEditOriginalReport` = false para todos |
| Declarar "solucionado" un caso | Imposible: techo institucional; llega hasta `SOLUTION_PROPOSED` |
| Ocultar o rechazar un reporte crítico | Sin capacidad `moderation.*`; 403 `FORBIDDEN` |
| Ver quién votó en contra de su gestión (votos nominativos) | Los votos de verificación son de la ciudadanía; el detalle de identidad no se expone a roles institucionales |
| Leer notas internas de otra organización | `canReadInternalNotes` lo impide, incluso al admin |
| Gestionar reportes de otra comuna | `inScope()` lo impide |
| Borrar su historial de acciones | Auditoría append-only |

## Gobernanza operativa

- **Moderación independiente**: los moderadores no tienen vínculo contractual con las municipalidades licenciadas. Sus decisiones (rechazo/ocultamiento/restauración) exigen fundamento público visible.
- **Transparencia radical por defecto**: reportes, transiciones, respuestas institucionales y fundamentos de moderación son públicos. Lo privado es la excepción (ubicación exacta, notas internas) y está justificado en `docs/PRIVACY_AND_SECURITY.md`.
- **Portabilidad**: si una municipalidad termina su licencia, los reportes ciudadanos de su comuna permanecen (son de la ciudadanía), con tombstones donde corresponda. La historia no se borra con el contrato.
