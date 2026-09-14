# FLM — Modelo de negocio municipal

FLM es gratis para la ciudadanía, siempre. Las municipalidades pagan una licencia por comuna: la plataforma les entrega gestión de casos, trazabilidad pública y datos para priorizar inversión, a cambio de someterse a reglas de independencia que no pueden comprar ni configurar (ver `docs/INDEPENDENCE_AND_GOVERNANCE.md`).

## Planes

### Comuna Conectada (base)
- Recepción y gestión de reportes de la comuna (panel municipal).
- Trazabilidad pública de estados y respuestas institucionales.
- Códigos públicos de seguimiento por reporte.
- Exportación básica de datos (CSV).
- Soporte estándar.

### Gestión Avanzada
Todo lo de Comuna Conectada, más:
- Derivación a organismos externos (eléctricas, sanitarias) con seguimiento.
- Gestión de miembros y roles por departamento.
- Tableros e indicadores (tiempos de respuesta, tasa de verificación ciudadana).
- Exportación avanzada / API para integrar con sistemas municipales.
- Acompañamiento en la puesta en marcha y soporte prioritario.

Ambos planes operan bajo las mismas reglas de independencia: **ningún plan compra la capacidad de editar reportes, moderar o auto-verificar soluciones**. Eso no está a la venta.

## Piloto 90 días

Para municipalidades que quieren probar antes de licenciar:

1. **Días 1–15 — Puesta en marcha**: se crea la organización municipal, se cargan departamentos y categorías de la comuna, se crean los usuarios funcionarios y se capacita al equipo (2 sesiones).
2. **Días 16–75 — Operación**: los vecinos reportan; la municipalidad gestiona con acompañamiento semanal. Se mide: tiempo medio de primera respuesta, % de reportes con respuesta institucional, tasa de verificación ciudadana.
3. **Días 76–90 — Evaluación**: informe con los indicadores del piloto y decisión de continuidad a Comuna Conectada o Gestión Avanzada.

**Criterio de éxito del piloto**: al menos 60% de los reportes con respuesta institucional dentro del plazo comprometido y una tasa de verificación ciudadana medida (el número exacto se acuerda con la comuna al inicio, porque depende de su línea base).

## Límites del modelo

- Una licencia = una comuna. Un funcionario no cruza a otra comuna (`inScope`).
- Si la municipalidad termina el contrato, los reportes ciudadanos permanecen públicos (son de la ciudadanía) y la organización pasa a estado inactivo con tombstones donde corresponda.
- La moderación independiente no depende de ninguna municipalidad cliente: su financiamiento y línea jerárquica están separados para evitar conflictos de interés.
