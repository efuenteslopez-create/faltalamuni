# FLM — Producto

**Falta la Muni** (FLM) es una plataforma GovTech chilena donde vecinos reportan problemas urbanos de su comuna (baches, luminarias apagadas, microbasurales, veredas rotas) y pueden seguir, con evidencia pública, qué hizo la institución responsable hasta que el problema se declara solucionado… y esa solución es verificada por la ciudadanía, no por la misma institución que la ejecutó.

## El problema que resuelve

Hoy el reclamo municipal típico entra por teléfono, correo o ventanilla: no tiene número de seguimiento público, no hay plazo visible y la respuesta (si llega) no se puede contrastar. FLM invierte la asimetría: el reporte es público desde el minuto uno, cada cambio de estado queda registrado con actor y fundamento, y **ninguna institución puede auto-declararse exitosa** — la verificación final es ciudadana e independiente.

## Usuarios

| Usuario | Qué hace en FLM |
|---|---|
| **Vecina/o (RESIDENT)** | Crea reportes con foto y ubicación, confirma reportes de otros ("yo también vi este problema"), sigue casos, vota la verificación de soluciones, reabre casos mal resueltos. |
| **Vecina/o verificada/o (VERIFIED_RESIDENT)** | Lo mismo, con mayor peso en el quórum de verificación ciudadana. |
| **Funcionario municipal (MUNICIPAL_AGENT)** | Recibe, clasifica, asigna y gestiona reportes de su comuna; informa soluciones con evidencia. |
| **Jefatura municipal (MUNICIPAL_MANAGER)** | Lo mismo + deriva a organismos externos, gestiona miembros, exporta datos. |
| **Agencia externa (EXTERNAL_AGENCY_AGENT)** | Atiende reportes derivados (ej. empresa eléctrica, sanitaria) dentro de su ámbito. |
| **Moderación independiente (INDEPENDENT_MODERATOR)** | Modera contenido (rechaza con fundamento, oculta), sin vínculo con las municipalidades. |
| **Admin plataforma (PLATFORM_ADMIN)** | Operación de la plataforma; **no puede editar reportes ni ver notas internas municipales**. |

## Flujos principales

1. **Reportar**: la vecina crea un reporte (categoría, título, descripción, ubicación en mapa, foto opcional, clave de idempotencia). Recibe un código público (`FLM-PUD-000123`) para seguimiento. El reporte nace público.
2. **Acompañar**: otros vecinos confirman ("me pasa lo mismo") y siguen el caso; las confirmaciones alimentan la priorización.
3. **Gestionar**: la municipalidad acusa recibo, clasifica, asigna a un departamento o deriva a un organismo externo. Todo cambio exige actor identificado y queda en la bitácora.
4. **Informar solución**: la institución declara la solución **con evidencia** (foto/documento). Esto NO cierra el caso: lo deja en "solución informada".
5. **Verificar**: se abre un período de verificación ciudadana. Con el quórum de vecinos independientes (`FLM_VERIFICATION_QUORUM`, default 3), el caso pasa a "solucionado verificado" y la comuna se anota el sello *"Ya estuvo la Muni"*. Si los vecinos no están conformes, el caso se **reabre con fundamento**.
6. **Moderar**: la moderación independiente puede rechazar (con fundamento público obligatorio) u ocultar contenido problemático. Las municipalidades no moderan.

## Alcance del MVP

- Reportes con foto, geolocalización y código público de seguimiento.
- Máquina de estados de 13 estados con validación 100% en servidor.
- Matriz de permisos por capacidades y alcance por comuna.
- Verificación ciudadana con quórum configurable y reapertura.
- Moderación independiente separada de las instituciones.
- Auditoría append-only de toda acción sensible.
- PWA con modo offline (service worker; nunca cachea `/api`).
- Adaptador de persistencia demo en JSON (ver `docs/ARCHITECTURE.md`).

## Fuera de alcance (MVP)

- Pagos, multas o cobros a vecinos.
- Chat en tiempo real entre vecinos y funcionarios (la comunicación es vía respuestas institucionales públicas).
- Integración con sistemas municipales legacy (se ofrece API y exportación).
- App nativa iOS/Android (PWA instalable).
- Múltiples instancias con escritura concurrente (limitación del adaptador demo, ver `docs/DEPLOYMENT.md`).
- Notificaciones push (la campana in-app llega en el MVP; push queda para después).
