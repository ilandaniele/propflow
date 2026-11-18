# Estado — /crear-app sobre Propflow (app existente)

Actualizado: 2026-11-17. La app está en producción en `https://propflow-app.fly.dev` (Fly). Decisión del owner: salir de Airtable y migrar a Cloudflare (`docs/07-migracion-cloudflare.md`).

| Fase | Estado | Nota |
|---|---|---|
| 0 Bootstrap | Hecha | `CLAUDE.md`; `gh` logueado (ilandaniele); `flyctl` logueado con otra cuenta (nailscodev), sin acceso a `propflow-app` |
| 1 Entrevista | N/A | App existente; objetivo: seguridad, buenas prácticas, salida de Airtable, Cloudflare |
| 2 Documentos | Hecha | `docs/01..07` |
| 3 Arquitectura | Hecha | Plan Cloudflare en `docs/07` (Workers + D1 + R2) |
| 4 Infra | Pendiente | Necesita al owner: cuenta, token, D1, R2 (`docs/07` §13). `wrangler.jsonc` tiene un `database_id` placeholder hasta crear la D1 |
| 5 Desarrollo | En curso | Ola de seguridad 1 mergeada; salida de Airtable hecha (copia final + código removido); migración a Cloudflare: Olas 1-4 de código hechas en `feat/cloudflare-d1` (sin push) |
| 6 Seguridad | Hecha (auditoría) | `docs/security-report.md`; plan de corrección W-01..W-54 en `docs/06` |
| 7 Tests y performance | Hecha (baseline) | k6 local en `tests/load/` (p95 < 90 ms hasta 50 VUs). La cobertura está por debajo del gate (74,7 % de líneas) |
| 8 Verificación y entrega | Pendiente | |

## Mergeado a `main`
- #75: Airtable atado a una sola org (F-01).
- #76: contraseñas con PBKDF2 y rehash de bcrypt (W-CF-01).
- #77: errores de lint (W-03).
- #78: next 16.4 y next-auth beta.32 (F-02).
- #80: zod 4.
- #82: endurecimiento de CI (W-02).
- #94: el bundle del worker entra en Workers Free (3,14 MB gzip).
- #97: W-CF-02, copia final de los adjuntos de Airtable.
- #99: `pnpm audit` ignora solo un GHSA sin fix (decisión del owner).
- #101: el motivo de un upload fallido incluye el error de storage (sin el path).
- #102: fix de regresión de #94: `PutObject` devolvía `411 MissingContentLength` (el fetch parcheado de Next re-streamea el body de un `Request`). Todos los uploads de producción fallaban.
- #103: fallas permanentes de la copia quedan en el manifest y se saltean.
- #104: la fase de snapshots pide todos los campos; un campo renombrado en Airtable ya no rompe la tabla entera (`422 UNKNOWN_FIELD_NAME`).
- #96: Airtable removido (W-CF-03..06). Sin migraciones; `src/lib/airtable-final` queda para auditoría.
- #81 (spike OpenNext) cerrado: cubierto por #94.

## Copia final de Airtable (W-CF-02)
Terminada el 2026-11-17: `remaining: 0` (run 44167931927, verificación dry-run sin pendientes). 369 adjuntos no se pueden copiar; quedan en `manifest.failed` con su motivo: casi todos `attachment_not_found` (campo o adjunto que ya no existe en Airtable), algunos `record_not_found` y `unsupported_type`. Segunda pasada (modo `recover`, solo lectura de Airtable, run 44191623623): 252 recuperados a nuestro storage. Quedan 117 en `manifest.failed`: 43 `record_deleted` (el registro ya no existe en Airtable), 73 `not_found` (el adjunto ya no está en el registro) y 1 foto archivada cuyo tipo no sirve para la columna. Decisión del owner (2026-11-17): se dan por perdidos. Airtable no se modificó. Verificación completa (modos `verify` y `refresh`, #110 y #111, 2026-11-17): todos los registros de Airtable están en `airtable_snapshots`; los snapshots se actualizaron a los valores de hoy (versión anterior archivada en `airtable-archive/snapshots-before-refresh/`) y se copiaron 920 adjuntos subidos después de la copia final. Verify final: 0 registros faltantes, 0 campos distintos, 0 adjuntos sin copiar. Tabla `feedback` no verificable (403: el token no tiene acceso). 5 filas siguen con URL de Airtable (`responsables.photo_url` 3, `tenants.photo_url` 1, `trash_compliance.foto_url` 1): son pérdidas aceptadas.

## Migración a Cloudflare (`docs/07`)
Rama `feat/cloudflare-d1` (local, sin push). Producción sigue en Fly hasta el cutover (W-CF-60); los artefactos de Fly y Postgres se remueven en W-CF-55, después de que el owner apruebe el decommission.

- Hecho (Olas 1-4 de código): W-CF-30..43 y W-CF-53. Schema y queries en `sqlite-core` sobre D1 (binding `DB`, migraciones en `src/lib/db/migrations-d1/`), storage en R2, Cron Triggers y build con OpenNext.
- CI (`.github/workflows/ci.yml`): corre `pnpm test:sql` (D1 local con Miniflare) y `node --test` de los scripts `scripts/migrate-to-d1` y `scripts/migrate-to-r2`; `pnpm cf:build && pnpm cf:size` valida el tamaño del Worker. El job `deploy-cloudflare` solo corre con la variable `DEPLOY_TARGET=cloudflare`; aplica las migraciones D1 y después `wrangler deploy`.
- Nada de esto se ejecutó contra Cloudflare: no existe ningún recurso remoto todavía.

### Pendiente del owner para Cloudflare
- API token de Cloudflare como secret de GitHub (`CLOUDFLARE_API_TOKEN`) y account id como variable (`CLOUDFLARE_ACCOUNT_ID`).
- Aprobar la creación de D1 `propflow-db` y `propflow-db-staging`, y de R2 `propflow-files` y `propflow-files-staging`.
- Token S3 de R2 (`R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_S3_ENDPOINT`).
- Decidir Workers Paid después de medir el CPU por ruta en el preview (umbral: p99 > 10 ms sostenido; `docs/07` §12).
- Dominio.
- Cutover (W-CF-60): importar Postgres a D1, copiar Tigris a R2, cambiar `DEPLOY_TARGET`.

## Bloqueos que dependen del owner
- `flyctl auth login` con la cuenta dueña de `propflow-app`.
- Cloudflare: API token como secret de GitHub, D1, R2 y token S3 de R2 (`docs/07` §13).
- GitHub: protección de rama en `main`, secret scanning y push protection (F-11, F-12).
- Resend: dominio verificado (bloquea el reset de contraseña y la verificación de email: F-23, F-25).

## Siguiente
- Migración a Cloudflare: ensayo en staging y cutover cuando el owner cree los recursos (ver arriba). Después W-CF-55 (remover Fly/Postgres).
- El resto de `docs/06` (F-04..F-18 altos), re-targeteado a D1.
- Backup: `../propflow-backups/propflow-2026-11-17.dump` (pg_dump del 2026-11-17).
