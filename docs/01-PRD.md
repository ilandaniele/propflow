# 01 — PRD de Propflow (ingeniería inversa)

> Documento reconstruido a partir del código existente en `src/` (rama principal desplegada en `https://propflow-app.fly.dev`). No describe funciones nuevas: describe lo que el código ya hace. Todo lo que no surge directamente del código está marcado como **Supuesto**.
>
> Documentos relacionados: `03-app-flow.md` (pantallas y flujos) y `04-UI-UX-brief.md` (sistema de diseño).

## 1. Resumen

Propflow es un SaaS multi-organización para propietarios y administradores de inmuebles de renta en Perú, con foco en propiedades compartidas (habitaciones/unidades dentro de una propiedad). Centraliza propiedades, unidades, inquilinos, contratos, pagos, cargos adicionales, incidencias, tareas, sanciones, comunidad y finanzas en un panel de administración, y ofrece a los inquilinos un portal propio. Suma un agente de IA de leasing que atiende prospectos por WhatsApp (y por un widget web embebible), agenda visitas, gestiona un pipeline de leads y deriva a un humano cuando hace falta. Los datos operativos se sincronizan diariamente desde Airtable, que hoy es la fuente de verdad histórica del negocio.

Stack: Next.js 16 (App Router) + React 19, Drizzle ORM sobre Postgres (Fly), NextAuth v5 con sesiones en base de datos, almacenamiento en Tigris (S3), Anthropic SDK para IA, Meta WhatsApp Cloud API, Vapi para voz, Google Calendar, Resend para email. Idiomas de interfaz: `es` (por defecto), `en`, `pt`.

## 2. Problema

El landing (`src/app/page.tsx`) lo formula así: la gestión de propiedades compartidas se hace con planillas, chats sueltos y Airtable, sin una vista consolidada de contratos, pagos, incidentes, tareas y rentabilidad por unidad. Además, la captación de inquilinos por WhatsApp depende de que una persona responda a toda hora.

Consecuencias que el código intenta resolver:

- Cobranza opaca: pagos pendientes, cargos adicionales y estados de cuenta dispersos (módulos `payments`, `additional-charges`, `account-statements`).
- Mantenimiento sin trazabilidad: incidencias sin fotos, prioridad ni historial (módulo `incidents`).
- Leads perdidos fuera de horario: respuesta lenta a consultas de prospectos (agente de IA, `agent/*`, `leads`, `visits`).
- Datos duplicados entre Airtable y otras herramientas (sincronización `cron/airtable-sync`).

## 3. Objetivo

Dar al administrador un único panel conectado a sus datos reales (Airtable sincronizado) para operar el día a día, y dar al inquilino un canal de autoservicio (pagos, contrato, incidencias, avisos), mientras un agente de IA atiende la demanda entrante y convierte prospectos en visitas.

## 4. Métricas de éxito

Las métricas que el código ya calcula o registra son:

| Métrica | Dónde se calcula | Tipo |
|---|---|---|
| Total cobrado, total pendiente, tasa de cobranza, mix por método, tendencia mensual | `computePaymentKpis` en `dashboard/payments` | Negocio |
| Ocupación y salud de datos por entidad | `dashboard/page.tsx` (`lib/dashboard/health`) | Operación |
| Primera respuesta del agente p50/p90, conversión lead→visita, % de handoff, costo de IA | `dashboard/agent` (según `handoffs/final-status.md`) | Agente |
| Estado de la sincronización Airtable (`ok`/`partial`/error) | `api/admin/integrations/airtable/status` | Integración |

**Supuesto:** no existen objetivos numéricos (targets) definidos en el código. Se proponen como metas iniciales: tasa de cobranza mensual ≥ 90 %, primera respuesta del agente p90 < 1 min dentro de la ventana de 24 h, conversión lead→visita ≥ 25 % y sincronización Airtable en estado `ok` en ≥ 95 % de las corridas diarias.

## 5. Usuarios y roles

El modelo de autorización tiene dos roles persistidos en `profiles.role` (`'admin' | 'tenant'`), uno por usuario (`profiles.user_id` es único: un usuario pertenece a una sola organización). Toda consulta se filtra por `org_id` del perfil.

| Rol / actor | Cómo se obtiene | Área |
|---|---|---|
| **Administrador (admin)** | Alta propia por `/register` o Google: se crea una organización nueva y un perfil `admin` (`provisionOrgAndProfile`). | `/dashboard/*` |
| **Co-administrador por allowlist** | Email en `STATIC_ADMIN_ALLOWLIST` (`src/lib/auth/admin-allowlist.ts`, dos correos fijos) o en la variable `ADMIN_ALLOWLIST`. En el primer ingreso con Google se adjunta como `admin` a la organización principal (la del `PRIMARY_OWNER_EMAIL`, o la más antigua). El registro con contraseña de esos correos está bloqueado (`USE_GOOGLE`). | `/dashboard/*` |
| **Inquilino (tenant)** | Invitación del admin (`/api/admin/tenants/[tenantId]/invite` → `/invite/accept`), vinculación manual desde la ficha (`linkTenantPortalAccount`) o auto-vinculación por email al registrarse (`attemptAutoLink`). | `/portal/*` |
| **Prospecto / lead** (sin cuenta) | Escribe por WhatsApp, por el widget web o desde las páginas públicas `/p/[orgSlug]`. | Canales externos |
| **Firmante de contrato** (sin cuenta) | Recibe un enlace con token (`sendSignatureRequest`). | `/sign/[token]` |
| **Sistemas** | Cron con `CRON_SECRET`, webhooks de Meta (firma) y Vapi (secreto con `timingSafeEqual`). | `/api/cron/*`, `/api/whatsapp/webhook`, `/api/agent/voice/vapi` |

No hay roles más finos (por ejemplo "asesor" o "solo lectura"): todos los admins de una organización tienen los mismos permisos. Los "miembros de ruteo" de leads (`lead-routing.ts`) son perfiles admin a los que se asignan leads, no un rol distinto.

### 5.1 Matriz de permisos (resumen)

| Capacidad | admin | tenant | anónimo |
|---|---|---|---|
| CRUD propiedades, unidades, imágenes de unidad | Sí | Solo ver imágenes de su unidad | No |
| CRUD inquilinos, notas internas, invitaciones, vinculación de cuenta | Sí | Editar su avatar, idioma y WhatsApp | No |
| Contratos, plantillas, PDF, solicitud de firma | Sí | Ver su contrato y descargar su PDF | Firmar con token |
| Registrar pago | Sí | Sí, solo sobre su contrato (queda `pending`) | No |
| Aprobar / rechazar pago, crear cargos, importar CSV de pagos | Sí | Importar CSV de sus movimientos | No |
| Incidencias | Gestionar y comentar | Crear (con foto) y comentar las propias | No |
| Tareas | Crear, cancelar, verificar prueba | Ver y subir prueba | No |
| Sanciones | Proponer, aprobar, rechazar | Ver y disputar | No |
| Anuncios, comunidad | Crear, publicar, fijar | Leer y comentar | No |
| Visitantes | Registrar y editar | Registrar los propios | No |
| Finanzas, pronósticos, tarifas, recibos OCR, IA analista/brief/asistente | Sí | No | No |
| Agente IA (configuración, bandeja, playground, llamadas, QA, widget) | Sí | No | No |
| Sincronización Airtable e importaciones | Sí | No | No |
| Catálogo público y widget | Configurar | — | Ver y chatear |

## 6. Funciones del MVP (historias de usuario)

Prioridad: **P0** = imprescindible para operar; **P1** = valor importante pero el negocio funciona sin ella.

### 6.1 Autenticación y alta — P0

**Historia A1.** Como administrador, quiero crear una cuenta con email y contraseña o con Google para empezar a usar Propflow con mi propia organización.

```gherkin
Escenario: Registro con email crea organización
  Dado que no existe un usuario con "ana@ejemplo.pe"
  Cuando envío /register con nombre, email y contraseña de 8 o más caracteres
  Entonces se crea el usuario con hash bcrypt (costo 12)
  Y se crea una organización y un perfil con rol "admin"
  Y se abre una sesión y soy redirigido a /auth/callback y luego a /dashboard

Escenario: Email ya registrado
  Dado que existe un usuario con "ana@ejemplo.pe"
  Cuando intento registrarme con ese email
  Entonces veo el error "Ya existe una cuenta con este correo. Inicia sesión."

Escenario: Email de la allowlist intenta registrarse con contraseña
  Cuando el email pertenece a la allowlist de administradores
  Entonces veo "Esta cuenta debe iniciar sesión con Google." y no se crea el usuario
```

**Historia A2.** Como usuario, quiero iniciar sesión y llegar a mi área según mi rol.

```gherkin
Escenario: Login correcto
  Dado un usuario con contraseña válida
  Cuando envío /login con credenciales correctas
  Entonces se crea una sesión en base de datos
  Y /auth/callback me redirige a /dashboard si soy admin o a /portal si soy tenant

Escenario: Credenciales inválidas o rate limit
  Cuando envío credenciales incorrectas
  Entonces veo "Invalid email or password" sin revelar si el email existe
  Y tras más de 5 intentos en 10 segundos desde la misma IP recibo RATE_LIMITED

Escenario: Google sin perfil provisionado
  Dado que el OAuth terminó pero no existe perfil
  Entonces soy redirigido a /login?error=account_not_created con un banner explicativo
```

**Historia A3 (P1).** Como usuario que olvidó su contraseña, quiero recuperarla. Hoy `requestPasswordReset` responde `NOT_IMPLEMENTED` y sugiere Google; el criterio vigente es:

```gherkin
Escenario: Recuperación no disponible
  Cuando envío mi email en /forgot-password
  Entonces veo un mensaje que indica usar el ingreso con Google
```

### 6.2 Invitación y portal del inquilino — P0

**Historia T1.** Como admin, quiero invitar a un inquilino al portal; como inquilino, quiero aceptar la invitación con Google o contraseña.

```gherkin
Escenario: Aceptar invitación válida
  Dado un token de invitación pendiente y vigente para "luis@ejemplo.pe"
  Y estoy autenticado con "luis@ejemplo.pe" y sin perfil en otra organización
  Cuando la página /invite/accept llama POST /api/invite/accept
  Entonces se crea mi perfil "tenant" en la organización que invita
  Y el registro del inquilino queda vinculado con portal_access "active"
  Y la invitación pasa a "accepted" y soy enviado a /portal

Escenario: Email distinto al invitado
  Cuando la sesión pertenece a otro email
  Entonces recibo 403 EMAIL_MISMATCH

Escenario: Invitación vencida o usada
  Entonces recibo 410 TOKEN_EXPIRED o 409 INVITATION_NOT_PENDING

Escenario: Usuario de otra organización
  Dado que ya tengo un perfil en otra organización
  Entonces recibo 409 ALREADY_IN_ORG
```

**Historia T2.** Como inquilino, quiero ver un resumen de mi unidad, contrato, pagos, avisos y tareas en `/portal`.

```gherkin
Escenario: Acceso al portal
  Dado que mi perfil es "tenant"
  Cuando abro /portal
  Entonces veo solo datos del inquilino vinculado a mi usuario dentro de mi organización
  Y si mi perfil es "admin" soy redirigido a /dashboard
```

### 6.3 Propiedades, unidades e inquilinos — P0

**Historia P1.** Como admin, quiero registrar propiedades y unidades (con área, fotos y portada) y asignar inquilinos a unidades.

```gherkin
Escenario: Alta de unidad con imágenes
  Dado que soy admin
  Cuando creo una unidad con createUnit dentro de una propiedad de mi organización
  Y subo imágenes con uploadUnitImage y elijo una portada
  Entonces la unidad aparece en /dashboard/units con su imagen de portada
  Y ninguna operación acepta IDs de otra organización (respuesta NOT_FOUND)
```

**Historia P2.** Como admin, quiero ver la ficha 360° del inquilino (pestañas: datos, contratos, pagos, notas internas, portal) en `/dashboard/tenants/[id]`.

```gherkin
Escenario: Nota interna
  Cuando agrego una nota con addInternalNote
  Entonces se guarda asociada al inquilino y no es visible en el portal
```

### 6.4 Contratos y firma — P0

**Historia C1.** Como admin, quiero crear contratos desde plantillas, generar el PDF y enviarlo a firmar.

```gherkin
Escenario: Firma electrónica
  Dado un contrato con PDF generado
  Cuando ejecuto sendSignatureRequest
  Entonces el firmante recibe un enlace /sign/[token]
  Y al dibujar su firma y enviarla a /api/sign/[token] el contrato queda firmado
  Y un token inválido o usado devuelve error sin exponer datos del contrato
```

### 6.5 Pagos y cobranza — P0

**Historia F1.** Como inquilino, quiero informar un pago; como admin, quiero aprobarlo o rechazarlo.

```gherkin
Escenario: Inquilino informa pago
  Dado que soy tenant con un contrato propio
  Cuando envío recordPayment con contract_id, monto, fecha y método
  Entonces se crea un pago en estado "pending"
  Y si el contrato no es mío recibo FORBIDDEN

Escenario: Admin aprueba pago
  Cuando el admin ejecuta approvePayment sobre un pago de su organización
  Entonces el pago pasa a "approved" con approved_by y approved_at
  Y aprobarlo de nuevo devuelve CONFLICT
```

**Historia F2.** Como admin, quiero ver KPIs de cobranza correctos sobre todos los pagos, no solo los mostrados.

```gherkin
Escenario: KPIs sobre el total
  Dado que la organización tiene más de 200 pagos
  Cuando abro /dashboard/payments
  Entonces "Cobrado", "Pendiente" y la tasa de cobranza se calculan sobre todos los pagos
  Y la tabla muestra como máximo los 200 más recientes
```

**Historia F3 (P1).** Como admin, quiero importar pagos e inquilinos por CSV con verificación previa (`/import/check` → `/import`) y plantilla descargable.

### 6.6 Incidencias — P0

**Historia I1.** Como inquilino, quiero reportar una incidencia con foto desde el celular y seguir su estado.

```gherkin
Escenario: Incidencia con foto
  Dado que estoy en /portal/incidents/new desde un móvil
  Cuando adjunto una foto con la cámara (Permissions-Policy camera=(self) en /portal)
  Y envío createIncident
  Entonces la incidencia queda asociada a mi inquilino y visible para el admin
  Y el admin puede cambiar estado y prioridad con updateIncident y comentar
```

### 6.7 Sincronización con Airtable — P0

**Historia S1.** Como admin, quiero que mis datos de Airtable (Residentes, Propiedades, Portafolio, Movimientos, Historial, Responsables, Pago de servicios, Incidencias) se reflejen en Propflow.

```gherkin
Escenario: Sincronización diaria y manual
  Dado que AIRTABLE_PAT y AIRTABLE_BASE_ID están configurados
  Cuando corre el cron diario o pulso "Sincronizar" en /dashboard/admin/integrations/airtable
  Entonces se ejecuta runAllAirtableSyncs y el estado queda en ok, partial o error
  Y el cron rechaza llamadas sin CRON_SECRET
```

### 6.8 Agente de IA de leasing — P0 (WhatsApp) / P1 (widget, voz)

**Historia G1.** Como admin, quiero que un agente de IA responda a prospectos por WhatsApp y que pueda tomar el control cuando haga falta.

```gherkin
Escenario: Tomar control de una conversación
  Dado una sesión en modo "ai" de mi organización
  Cuando ejecuto takeOverSession en /dashboard/agent/inbox/[sessionId]
  Entonces la sesión pasa a "human" y se registra un evento mode_change

Escenario: Devolver a la IA
  Cuando ejecuto returnSessionToAi
  Entonces la sesión vuelve a "ai", se reinicia el tope de turnos
  Y si hay mensajes entrantes pendientes se encola un turno del agente

Escenario: Fuera de la ventana de 24 h
  Cuando intento responder con texto libre fuera de la ventana
  Entonces veo "Fuera de la ventana de 24 h: solo plantillas aprobadas"

Escenario: Modo sombra
  Dado shadow_mode activo
  Entonces el agente genera sugerencias que el admin aprueba o descarta antes de enviarse
```

**Historia G2.** Como admin, quiero agendar visitas (manuales o por el agente) según disponibilidad y sincronizarlas con Google Calendar.

```gherkin
Escenario: Visita manual
  Cuando creo una visita con createVisitManual en una franja disponible
  Entonces aparece en /dashboard/visits y se programan recordatorios 24 h y 2 h
```

**Historia G3.** Como admin, quiero un pipeline de leads por etapas con asignación (manual o automática) y "no contactar".

**Historia G4 (P1).** Como admin, quiero publicar un catálogo público (`/p/[orgSlug]`) y un widget de chat embebible con clave pública rotable.

**Historia G5 (P1).** Como admin, quiero probar el agente en un playground y exportar conversaciones para QA.

### 6.9 Operación complementaria — P1

- Tareas para inquilinos con prueba fotográfica y verificación (`tasks`).
- Sanciones con propuesta, aprobación y disputa del inquilino (`sanctions`).
- Anuncios, recordatorios programados, limpieza y comunidad (`ops`, `community`).
- Registro de visitantes (`visitors`).
- Finanzas: gastos por categoría, recibos con OCR y conciliación con pagos, rentabilidad por habitación, servicios (agua/luz/gas/internet), pronósticos, tablas de precios, comprobantes tributarios.
- Inteligencia: brief ejecutivo con detector de fugas, analista determinístico, asistente de IA (`/api/ai/chat`).
- Resumen semanal y recordatorios por email (cron `weekly-summary`, `reminders`, `task-reminders`).

## 7. Fuera de alcance

- **Llamadas de voz salientes**: el módulo de voz (Vapi) existe, pero las llamadas salientes vienen apagadas hasta validar el marco legal peruano (`handoffs/final-status.md`). Las llamadas entrantes y el historial (`/dashboard/agent/calls`) quedan como P1.
- Campañas masivas por WhatsApp (backlog explícito).
- Cobro en línea / pasarela de pagos: no hay integración (no se encontró Stripe, Mercado Pago ni Culqi). Los pagos se informan y aprueban manualmente.
- Facturación del propio SaaS: el landing muestra precios, pero no hay suscripciones ni cobro (**Supuesto**: comercialización manual).
- Recuperación de contraseña por email (responde `NOT_IMPLEMENTED`).
- Verificación de email en el registro con contraseña (`emailVerified` queda nulo).
- Roles granulares dentro de una organización y pertenencia de un usuario a varias organizaciones.
- App móvil nativa (el portal es web responsive).

## 8. Requisitos no funcionales

- **Seguridad**: CSP estricta con nonce por request, HSTS con preload, `X-Frame-Options: DENY` y `frame-ancestors 'none'` (salvo el widget, que define su propio CSP por organización), `nosniff`, `COOP same-origin`, cámara solo en `/portal`. Validación con Zod en server actions y route handlers. Aislamiento por `org_id` en cada consulta (guardas IDOR). Login de tiempo constante (hash señuelo). Rate limit por IP en login/registro y por usuario en mutaciones.
- **Autenticación**: NextAuth v5 con estrategia `database`; la sesión se invalida si el perfil no existe. Google con vinculación por email permitida y revocación del password previo al vincular.
- **Resiliencia**: `withDbRetry` en la lectura de sesión y en crons; pool de Postgres con `idle_timeout`, `max_lifetime` y `connect_timeout` (máquinas Fly que se suspenden).
- **Rendimiento**: consultas en paralelo (`Promise.all`), tablas limitadas (por ejemplo 200 filas) con KPIs agregados aparte; `loading.tsx` con skeletons en casi todas las rutas del panel; caché de 300 s para el nombre de la organización.
- **Internacionalización**: `next-intl` con `es`, `en`, `pt`; locale en cookie `propflow_locale`; moneda y contexto peruanos (S/).
- **Privacidad**: app no indexable (`robots: noindex`) salvo landing; páginas `/privacidad` y `/terminos` públicas para Meta y Google; emails enmascarados en la vista previa de invitaciones; URLs firmadas para archivos en Tigris.
- **Operación**: despliegue en Fly por CI al hacer push a `main`; migraciones como `release_command`; `/api/health` para chequeos.

## 9. Supuestos y riesgos

### Supuestos

- **Supuesto:** cada organización es un propietario o administradora con una sola cuenta "principal"; los co-admins por allowlist son un mecanismo interno del dueño del producto, no una función para clientes.
- **Supuesto:** Airtable seguirá siendo la fuente de verdad por un tiempo; Propflow es la capa de operación y portal.
- **Supuesto:** la página `/onboarding` es un remanente. El callback de sesión invalida sesiones sin perfil, de modo que un usuario sin perfil llega a `/onboarding` sin sesión y es enviado a `/login`; uno con perfil es enviado a su área. En la práctica no se muestra.

### Riesgos

- **Rate limit en memoria**: no se comparte entre máquinas de Fly; con más de una instancia los límites son más laxos.
- **Email sin dominio verificado (Resend)**: recordatorios de renovación y entregas a inquilinos pueden no enviarse.
- **Allowlist hardcodeada en el código**: agregar o quitar co-admins requiere desplegar o tocar variables de entorno; los correos fijos forman parte del bundle del servidor.
- **Inconsistencia en `tenants.profile_id`**: `/api/invite/accept` y todas las lecturas del portal usan el `users.id`, pero `attemptAutoLink` guarda el `profiles.id`. Además, `attemptAutoLink` corre después de crear una organización nueva con perfil admin, por lo que puede vincular la fila de inquilino de otra organización al perfil admin recién creado. Ver detalle en `03-app-flow.md` §6.
- **Invitación con Google para usuarios nuevos**: el evento `createUser` crea una organización propia antes de aceptar la invitación, así que la aceptación posterior falla con `ALREADY_IN_ORG`. El camino que funciona es que el inquilino tenga cuenta previa en la misma organización o sea vinculado manualmente.
- **Dependencia de terceros**: plantillas de Meta aprobadas, ventana de 24 h de WhatsApp, verificación de la app de Google (Calendar en modo Testing), costos de Anthropic.
- **Calidad de datos de Airtable**: nombres de tablas y columnas cambiaron antes (por ejemplo "Incidencias"/"Urgencia"); un renombre en Airtable rompe la sincronización.
