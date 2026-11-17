# Estado — /crear-app sobre Propflow (app existente)

Rama de trabajo: `chore/crear-app-hardening`. La app ya existe y está en producción (`https://propflow-app.fly.dev`), así que las fases de construcción se adaptan: se documenta lo existente en vez de diseñarlo.

| Fase | Estado | Nota |
|---|---|---|
| 0 Bootstrap | Hecha | `CLAUDE.md` con BASE + bloque de proyecto; `gh` logueado (ilandaniele); `flyctl` logueado con otra cuenta (nailscodev), sin acceso a `propflow-app`; Cloudflare no aplica (hosting en Fly) |
| 1 Entrevista | N/A | App existente; objetivo del usuario: seguridad y buenas prácticas |
| 2 Documentos | En curso | Ingeniería inversa del código a `docs/01..06` |
| 3 Arquitectura | N/A | Ya existe |
| 4 Infra | N/A | Ya existe en Fly; sin cambios de infraestructura |
| 5 Desarrollo | N/A | Solo fixes que salgan de las fases 6-8 |
| 6 Seguridad | Pendiente | |
| 7 Tests y performance | Pendiente | |
| 8 Verificación y entrega | Pendiente | |
