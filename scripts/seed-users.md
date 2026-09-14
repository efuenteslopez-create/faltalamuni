# Usuarios demo — Falta la Muni (seed Pudahuel)

> Generados con `npm run seed`. Contraseña única para todos: **`Demo1234!`**
> Cambia estas credenciales antes de cualquier despliegue real.

| Email | Nombre | Rol | Organización / alcance |
|---|---|---|---|
| vecina@demo.flm | Camila Rojas | RESIDENT | Vecina (autora de reportes) |
| vecino.verificado@demo.flm | Jorge Paredes | VERIFIED_RESIDENT | Vecino verificado |
| agente@demo.flm | Ana Agente | MUNICIPAL_AGENT | Municipalidad de Pudahuel |
| gestora@demo.flm | Paula Gestora | MUNICIPAL_MANAGER | Municipalidad de Pudahuel (exporta CSV) |
| externo@demo.flm | Pedro Externo | EXTERNAL_AGENCY_AGENT | Empresa Eléctrica Demo |
| moderacion@demo.flm | Marta Moderadora | INDEPENDENT_MODERATOR | Moderación independiente (global) |
| admin@demo.flm | Admin Plataforma | PLATFORM_ADMIN | Plataforma (global, sin edición silenciosa) |

## Notas

- El registro público (`POST /api/auth/register`) siempre crea usuarios con rol
  `RESIDENT`; los roles institucionales se asignan por membership (como en este seed).
- `INDEPENDENT_MODERATOR` y `PLATFORM_ADMIN` tienen alcance global para
  moderación/auditoría, jamás para editar reportes ciudadanos.
- Ningún rol —ni siquiera `PLATFORM_ADMIN`— puede editar el contenido original
  de un reporte ni transicionar directamente a `VERIFIED_RESOLVED` siendo
  institucional: la verificación es ciudadana/independiente.
