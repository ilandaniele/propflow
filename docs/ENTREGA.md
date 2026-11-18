# Entrega — consumo estimado en Cloudflare

Estado: **estimación previa al cutover**. Todavía no hay recursos de Cloudflare ni mediciones reales (ver "Qué falta medir"). Los números de abajo son órdenes de magnitud con supuestos explícitos, no mediciones. Contexto y reglas de cuota: `docs/07-migracion-cloudflare.md` (§12 y riesgos R3, R5, R9).

## Cuotas de referencia

Las cuotas Free vienen de la regla de cuotas del proyecto (`cloudflare-cuotas.md`). Todas las apps de la cuenta comparten la misma cuota diaria. Pasarse en Free no cobra: las requests fallan hasta las 00:00 UTC.

| Recurso | Free | Paid (USD 5/mes base) |
|---|---|---|
| Workers requests | 100.000 / día, toda la cuenta | Incluye un cupo mensual; excedentes cobran (verificar) |
| Workers CPU | 10 ms por invocación | Mucho mayor (verificar) |
| Tamaño del Worker | 3 MB comprimido (`pnpm cf:size`) | Mayor (verificar) |
| D1 filas leídas | 5 M / día | Cupo mensual; excedentes cobran (verificar) |
| D1 filas escritas | 100.000 / día | Cupo mensual; excedentes cobran (verificar) |
| D1 tamaño | 5 GB | Mayor (verificar) |
| R2 almacenamiento | 10 GB | Cobra por GB-mes sobre el cupo (verificar) |
| R2 operaciones clase A (PUT, LIST) | 1 M / mes | Cobra sobre el cupo (verificar) |
| R2 operaciones clase B (GET, HEAD) | 10 M / mes | Cobra sobre el cupo (verificar) |

El egress de R2 es gratis. Los assets estáticos no ejecutan el Worker (`assets.run_worker_first: false` en `wrangler.jsonc`) y no cuentan como requests del Worker. Los archivos privados se sirven con URL firmada directo desde R2, así que no pasan por el Worker.

## Supuestos

Un "usuario activo del día" es un propietario/administrador o un inquilino que abre la app. Los valores de abajo son supuestos, no datos medidos; se reemplazan en el ensayo de staging.

- S-A. Un usuario activo hace unas 20 vistas de página por día.
- S-B. Cada vista genera de 2 a 4 requests al Worker (documento o RSC, prefetch de links, server actions). Se usa 3, es decir ~60 requests por usuario y día. `docs/07` R9 ya marca este número como el menos seguro.
- S-C. Cada request autenticado lee unas 2-3 filas por la sesión y el perfil (`docs/07` §3, estrategia `database`).
- S-D. Filas leídas por vista de página, según el tipo de consulta: ~100 con consultas indexadas y paginadas, hasta ~2.000 en el dashboard si los agregados recorren la tabla de payments (riesgo R3). El rango es amplio a propósito.
- S-E. Filas escritas por usuario y día: de 10 a 30 (login/sesión, rate limit en acciones caras, pagos, incidentes, mensajes).
- S-F. Archivos por usuario y día: de 1 a 3 subidas (clase A) y de 10 a 30 lecturas (clase B: fotos, comprobantes, avatares).
- S-G. Las invocaciones `scheduled` (Cron Triggers) no pasan por la red. Si cuentan como requests del Worker es un punto abierto en `docs/07` (verificar). Se suman por prudencia.

## Consumo fijo por día (sin usuarios)

| Recurso | Estimación | Origen |
|---|---|---|
| Invocaciones de cron | ~1.464 (1.440 por `* * * * *` y 24 por `0 * * * *`) | `wrangler.jsonc` |
| Filas leídas por el cron | del orden de 10.000 a 20.000 | Una consulta indexada de `agent_jobs` por minuto, más el barrido cada 5 minutos. Supuesto: pocas filas por consulta |
| Filas escritas por el cron | cercano a 0 sin trabajo pendiente | Solo escribe cuando hay jobs o recordatorios |

El cron fijo ocupa ~1,5 % de las requests Free y ~0,4 % de las lecturas D1 por día, si las invocaciones cuentan.

## Consumo por usuario activo y día

| Recurso | Por usuario y día | Cuenta |
|---|---|---|
| Requests al Worker | ~60 (S-A × S-B) | 60 |
| D1 filas leídas | ~2.000 a ~40.000 (20 vistas × 100 a 2.000 filas, más la sesión) | indexado: ~2.000; dashboard sin agregados guardados: ~40.000 |
| D1 filas escritas | ~10 a ~30 | S-E |
| R2 clase A | ~1 a ~3 | S-F |
| R2 clase B | ~10 a ~30 | S-F |

## Usuarios activos por día que aguanta Workers Free

Cuenta con el 100 % de la cuota de la app, sin otras apps. Dividir por el reparto real si la cuenta tiene otras apps.

| Recurso | Límite diario / mensual | Usuarios activos/día hasta agotarlo |
|---|---|---|
| Requests | 100.000 menos ~1.500 de cron | ~1.600 al 100 %; ~800 al 50 % (umbral de aviso de `docs/07` §12) |
| D1 filas leídas | 5 M menos ~20.000 del cron | ~125 si cada vista lee 2.000 filas; ~2.500 si lee 100 |
| D1 filas escritas | 100.000 | ~3.300 a ~10.000 |
| R2 clase A | 1 M / mes (~33.000 / día) | ~11.000 a ~33.000 |
| R2 clase B | 10 M / mes (~330.000 / día) | ~11.000 a ~33.000 |

Lectura del cuadro:

- El límite que manda es **filas leídas de D1**, no las requests. Con consultas indexadas y paginadas alcanza para cientos de usuarios por día; con agregados que recorren miles de filas por vista (R3) puede alcanzar para ~100.
- Las requests son el segundo límite (~800 usuarios activos por día al 50 %).
- Escrituras y R2 no son el cuello de botella en uso normal. La excepción es la importación del cutover (`docs/07` R5: tope de 100.000 filas escritas por día en Free).
- CPU por request y tamaño del Worker no se estiman acá: son los dos gates que deciden Free o Paid (`docs/07` §12) y se miden, no se estiman.
- Si la estimación con el tráfico real supera el 50 % de Free, es un riesgo a avisar: optimizar (resumen de KPIs guardado, `prefetch={false}`, Cache API) o pasar a Workers Paid. **Paid cobra: decisión del owner.**

## Qué falta medir (en el ensayo de staging)

1. Requests al Worker por sesión típica (S-B). `docs/07` R9 pide anotarlo acá.
2. Filas leídas por página: el dashboard ya registra `meta.rows_read` (evento `d1_rows_read` en `src/lib/dashboard/queries.ts`). Reemplaza S-D.
3. Filas escritas por acción frecuente y por el cron en reposo.
4. Si las invocaciones `scheduled` cuentan como requests (S-G).
5. CPU por ruta y tamaño del Worker (`pnpm cf:size`), para decidir Free o Paid.

Recomendación al owner: activar las notificaciones de uso del dashboard de Cloudflare (Notifications, uso de Workers y D1). No se cambia la configuración de la cuenta sin su aprobación.
