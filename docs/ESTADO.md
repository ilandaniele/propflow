# Estado — /crear-app sobre Propflow (app existente)

Actualizado: 2026-11-17. La app está en producción en `https://propflow-app.fly.dev` (Fly). Decisión del owner: salir de Airtable y migrar a Cloudflare (`docs/07-migracion-cloudflare.md`).

| Fase | Estado | Nota |
|---|---|---|
| 0 Bootstrap | Hecha | `CLAUDE.md`; `gh` logueado (ilandaniele); `flyctl` logueado con otra cuenta (nailscodev), sin acceso a `propflow-app` |
| 1 Entrevista | N/A | App existente; objetivo: seguridad, buenas prácticas, salida de Airtable, Cloudflare |
| 2 Documentos | Hecha | `docs/01..07` |
| 3 Arquitectura | Hecha | Plan Cloudflare en `docs/07` (Workers + D1 + R2) |
| 4 Infra | Pendiente | Necesita al owner: cuenta, token, D1, R2 (`docs/07` §13) |
| 5 Desarrollo | En curso | Ola de seguridad 1 mergeada; salida de Airtable en curso |
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

## En curso
1. #97, W-CF-02 (copia final de los adjuntos de Airtable). Después del merge: correr el workflow `Airtable final copy` en `dry-run` y después en `apply` hasta `remaining: 0`.
2. #96, remover Airtable (W-CF-03..06). Se mergea solo después de `remaining: 0`.
3. #81, spike de OpenNext: ya cubierto por #94; cerrar.

## Bloqueos que dependen del owner
- `flyctl auth login` con la cuenta dueña de `propflow-app`.
- Cloudflare: API token como secret de GitHub, D1, R2 y token S3 de R2 (`docs/07` §13).
- GitHub: protección de rama en `main`, secret scanning y push protection (F-11, F-12).
- Resend: dominio verificado (bloquea el reset de contraseña y la verificación de email: F-23, F-25).

## Siguiente
- Olas 1-4 de migración (`docs/07` §8): schema a `sqlite-core`, R2, Cron Triggers y excluir `src/instrumentation.ts` del build de Cloudflare.
- El resto de `docs/06` (F-04..F-18 altos), re-targeteado a D1.
- Backup: `../propflow-backups/propflow-2026-11-17.dump` (pg_dump del 2026-11-17).
