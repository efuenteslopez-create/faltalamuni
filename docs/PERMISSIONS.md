# FLM — Permisos

Fuente de verdad en código: `lib/domain/permissions.ts` (`PERMISSION_MATRIX`, `hasCapability`, `assertCapability`). Sin condicionales improvisados: toda autorización sensible pasa por aquí en el servidor.

## Matriz rol × capacidad

| Capacidad | RESIDENT | VERIFIED_RESIDENT | MUNICIPAL_AGENT | MUNICIPAL_MANAGER | EXTERNAL_AGENCY_AGENT | INDEPENDENT_MODERATOR | PLATFORM_ADMIN |
|---|---|---|---|---|---|---|---|
| `report.create` | ✅ | ✅ | | | | ✅ | ✅ |
| `report.confirm` ("yo también lo vi") | ✅ | ✅ | | | | ✅ | ✅ |
| `report.follow` | ✅ | ✅ | | | | ✅ | ✅ |
| `report.verify` (votar solución) | ✅ | ✅ | | | | | ✅ |
| `report.reopen` | ✅ | ✅ | | | | | ✅ |
| `institutional.acknowledge` | | | ✅ | ✅ | ✅ | | |
| `institutional.triage` | | | ✅ | ✅ | ✅ | | |
| `institutional.assign` | | | ✅ | ✅ | | | |
| `institutional.refer` | | | ✅ | ✅ | | | |
| `institutional.progress` | | | ✅ | ✅ | ✅ | | |
| `institutional.propose_solution` | | | ✅ | ✅ | ✅ | | |
| `institutional.request_verification` | | | ✅ | ✅ | | | |
| `institutional.internal_notes` | | | ✅ | ✅ | | | |
| `institutional.respond_public` | | | ✅ | ✅ | ✅ | | |
| `institutional.export` | | | | ✅ | | | ✅ |
| `institutional.manage_members` | | | | ✅ | | | |
| `moderation.hide` | | | | | | ✅ | ✅ |
| `moderation.reject` | | | | | | ✅ | ✅ |
| `moderation.restore` | | | | | | ✅ | ✅ |
| `platform.admin` | | | | | | | ✅ |

Notas:
- `INDEPENDENT_MODERATOR` puede crear/confirmar reportes como vecina/o, pero **no** verifica soluciones (para no concentrar poder de moderación + verificación).
- `EXTERNAL_AGENCY_AGENT` no asigna ni deriva: solo avanza lo que se le derivó.
- `PLATFORM_ADMIN` no tiene capacidades institucionales operativas (no gestiona reportes) ni ve notas internas.

## Alcance por comuna

Tener la capacidad no basta: `inScope(actor, municipalityId)` exige además que el actor pertenezca a la comuna del reporte.

- Un `MUNICIPAL_AGENT` de Pudahuel no puede ni ver el detalle interno de un reporte de Maipú.
- `PLATFORM_ADMIN` e `INDEPENDENT_MODERATOR` tienen alcance global **solo para sus capacidades** (moderación, auditoría); jamás para editar reportes ciudadanos.
- Las notas internas (`institutional.internal_notes`) solo las leen miembros de la propia organización; **ni siquiera el PLATFORM_ADMIN** puede leer notas internas ajenas (`canReadInternalNotes`).

## Regla de independencia

`canEditOriginalReport(role)` retorna `false` para **todos** los roles, siempre:

- Ningún rol institucional puede editar el texto, fotos, fecha ni ubicación original de un reporte ciudadano.
- La institución responde y gestiona **en respuestas separadas** (`institutionalResponses`), nunca reescribiendo lo que dijo la vecina.
- Correcciones excepcionales (ej. dato personal publicado por error) las ejecuta la moderación independiente con un `ModerationCase` auditable, no la municipalidad en silencio.

Ver `docs/INDEPENDENCE_AND_GOVERNANCE.md` para las garantías técnicas completas.
