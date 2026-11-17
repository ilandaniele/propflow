# 05 — Esquema de backend, modelo de autenticación y datos

Fuente de verdad del esquema: `src/lib/db/schema.ts` (Drizzle). La base es Postgres en Fly (`propflow-db2`) y tiene unas 89 tablas. Las migraciones SQL están en `src/lib/db/migrations`. Las inferencias que no se verificaron línea a línea están marcadas como **Supuesto**.

---

## 1. Modelo de aislamiento multi-organización

- No hay políticas RLS. La cabecera de `schema.ts` lo declara: "No RLS policies — isolation is enforced at the app layer".
- Toda tabla de dominio tiene `org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE`. Única excepción: `import_rows`, que hereda el scope de su `csv_imports` padre.
- El `orgId` nunca viene del cliente. Lo resuelven los guards de `src/lib/auth/guards.ts` (`requireUser`, `requireAdmin`, `requireTenant`) desde `profiles.org_id` del usuario de la sesión. Los guards están memorizados por petición con `React.cache`.
- Cada consulta incluye `eq(tabla.orgId, ctx.orgId)`. Para el rol `tenant` se añade el filtro por su propio `tenant_id`, `profile_id` o `uploaded_by` (prevención de IDOR).
- Rutas sin sesión: webhooks, cron, widget, firma y listings públicos. Estas rutas derivan el `org_id` del recurso autenticado (token, canal o sesión widget), nunca de un parámetro libre.
- Riesgo: un solo `where` olvidado expone datos de otra organización. No hay una segunda barrera en la base de datos. El script `test:rls` existe en `package.json`, pero el directorio `tests/rls` no existe en el repositorio. Los tests de aislamiento cruzado viven en los tests de integración de cada ruta (**Supuesto**).

---

## 2. Diagrama entidad-relación (núcleo)

El diagrama muestra las entidades principales. Las tablas satélite (Airtable, agente y voz) se listan en la sección 3.

```mermaid
erDiagram
  users ||--o{ accounts : "cascade"
  users ||--o{ sessions : "cascade"
  users ||--|| profiles : "cascade"
  organizations ||--o{ profiles : "cascade"
  organizations ||--o{ properties : "cascade"
  properties ||--o{ units : "cascade"
  organizations ||--o{ tenants : "cascade"
  profiles |o--o{ tenants : "set null"
  units |o--o{ tenants : "set null"
  responsables |o--o{ tenants : "set null"
  tenants ||--o{ contracts : "cascade"
  units ||--o{ contracts : "cascade"
  contracts ||--o{ charges : "cascade"
  contracts ||--o{ payments : "cascade"
  tenants ||--o{ payments : "cascade"
  import_logs |o--o{ payments : "set null"
  profiles |o--o{ payments : "approved_by set null"
  organizations ||--o{ incidents : "cascade"
  incidents ||--o{ incident_comments : "cascade"
  contracts ||--o{ signature_requests : "cascade"
  tenants ||--o{ tenant_invitations : "cascade"
  tenants ||--o{ tenant_tasks : "cascade"
  tenant_tasks ||--o{ task_proofs : "cascade"
  tenants ||--o{ sanctions : "cascade"
  charges |o--o| sanctions : "linked_charge set null"
  csv_imports ||--o{ import_rows : "cascade"
  organizations ||--o{ payment_receipts : "cascade"
  organizations ||--o{ listings : "cascade"
  units |o--o{ listings : ""
  listings ||--o{ listing_images : "cascade"
  units ||--o{ unit_images : "cascade"
  organizations ||--o{ agent_sessions : "cascade"
  agent_sessions ||--o{ agent_messages : "cascade"
  agent_sessions ||--o{ agent_suggestions : "cascade"
  crm_leads ||--o{ lead_assignments : "cascade"
  crm_leads ||--o{ lead_followups : "cascade"
  listings ||--o{ property_visits : ""
  profiles ||--o{ property_visits : "restrict"
  property_visits |o--o{ property_visits : "rescheduled_from set null"
  profiles ||--o{ calendar_connections : "cascade"
  agent_web_sessions ||--o{ agent_web_handoff_codes : "cascade"
  organizations ||--o{ agent_calls : "cascade"

  organizations { uuid id PK; text slug UK; text name }
  users { uuid id PK; text email UK; timestamptz email_verified; text password_hash }
  profiles { uuid id PK; uuid user_id FK,UK; uuid org_id FK; text role }
  tenants { uuid id PK; uuid org_id FK; uuid unit_id FK; text document_number }
  contracts { uuid id PK; uuid org_id FK; uuid tenant_id FK; uuid unit_id FK }
  payments { uuid id PK; uuid org_id FK; uuid contract_id FK; text status }
```

Algunos `onDelete` del diagrama no se verificaron uno por uno: `signature_requests`, `tenant_invitations`, `tenant_tasks`, `task_proofs`, satélites del agente y `listings`/`property_visits`. Para esos, el valor es **Supuesto** y sigue el patrón dominante (`cascade` hacia el padre).

---

## 3. Tablas

Convenciones comunes:
- PK `id uuid DEFAULT gen_random_uuid()`, salvo las excepciones indicadas.
- `org_id` es NOT NULL con FK `ON DELETE CASCADE` hacia `organizations`.
- Columnas `created_at`/`updated_at` en `timestamptz`.
- Las tablas sincronizadas desde Airtable tienen un índice único `(org_id, airtable_external_id)` o `(org_id, airtable_id)`.

### 3.1 Autenticación (NextAuth)

| Tabla | Claves | Índices | Org |
|---|---|---|---|
| `users` | PK `id`. `email` único. `email_verified`. `password_hash` (bcrypt, nullable) | Único `email` | Global |
| `accounts` | PK compuesta `(provider, provider_account_id)`. `user_id` FK `users` cascade | PK | Global |
| `sessions` | PK `session_token`. `user_id` FK cascade. `expires` | PK | Global |
| `verification_tokens` | PK `(identifier, token)` | PK | Global (sin uso hoy) |
| `organizations` | PK `id`. `slug` único | Único `slug` | Es la raíz del scope |
| `profiles` | `user_id` único FK `users` cascade. `org_id` FK cascade. `role` (`admin` o `tenant`) | `org_id`, `(org_id, role)` | Sí |

### 3.2 Núcleo inmobiliario

| Tabla | FKs relevantes (onDelete) | Índices / únicos |
|---|---|---|
| `properties` | `org_id` | `org_id`, único Airtable |
| `units` | `property_id` cascade. Columna `area_m2` | `org_id`, único Airtable |
| `responsables` | — | Solo único `(org_id, airtable_external_id)`; empieza por `org_id`, así que sirve para filtrar |
| `tenants` | `profile_id`, `responsable_id` y `unit_id` set null | `org_id`, único Airtable |
| `contracts` | `tenant_id` y `unit_id` cascade | `org_id` |
| `charges` | `contract_id` y `tenant_id` cascade | `org_id` |
| `payments` | `contract_id` y `tenant_id` cascade. `approved_by` set null. `import_id` hacia `import_logs` set null | `org_id`, único Airtable |
| `import_logs` | `org_id` | **Sin índices** |
| `incidents` | `created_by` cascade, el resto set null | `org_id`, único Airtable |
| `incident_comments`, `internal_notes` | `internal_notes.created_by` restrict | `org_id` |
| `service_payments` | Columna JSONB por servicio | Solo único `(org_id, airtable_external_id)` |

### 3.3 Finanzas, documentos y comunidad

`expense_categories`, `expenses`, `receipt_uploads`, `contract_templates`, `pricing_tables`, `crm_leads`, `community_posts`, `community_comments`, `announcements`, `cleaning_tasks`, `signature_requests`, `reminders`, `notification_inbox`, `visitor_logs`.

Todas tienen `org_id` con índice. Otras características:
- `payment_receipts` tiene un único `(org_id, image_sha256)` que deduplica comprobantes.
- `signature_requests.token` es un UUID en texto plano (no hasheado).

### 3.4 Importaciones y Airtable

| Tabla | Notas |
|---|---|
| `airtable_snapshots`, `airtable_sync_logs` | `org_id` indexado |
| `csv_imports` | `created_by` restrict |
| `import_rows` | **Sin `org_id`**. Scope vía `import_id` hacia `csv_imports` (cascade) |
| `account_mappings`, `property_mappings`, `phantom_rooms` | `org_id` |
| `ai_token_budget` | Presupuesto diario de tokens por org |
| `charge_concepts`, `additional_charges`, `account_statements`, `tax_receipts`, `tenant_feedback`, `owners`, `deposit_accounts`, `trash_schedules`, `trash_compliance`, `absences` | Espejo de Airtable. Único `(org_id, airtable_*)` |

### 3.5 Tareas, sanciones e invitaciones

| Tabla | Notas |
|---|---|
| `tenant_tasks` | `created_by` restrict |
| `task_proofs` | Fotos de prueba verificadas por IA |
| `sanctions` | `proposed_by` restrict. `linked_charge_id` único, set null |
| `tenant_invitations` | `token_hash` (sha256) único. Índice por `tenant_id`. **Sin índice que empiece por `org_id`** |
| `property_weekly_summaries` | Único `(property_id, iso_week)`. **Sin índice por `org_id`** |
| `unit_images`, `listing_images` | Índice único parcial: una sola portada. `uploaded_by` sin `onDelete` (NO ACTION) |

### 3.6 Agente IA, mensajería y leads

| Tabla | Notas |
|---|---|
| `org_channels` | Únicos parciales: un canal `web` y un canal `whatsapp` por org |
| `whatsapp_conversations` | Único `(org_id, external_phone)` |
| `whatsapp_messages` | Único `(org_id, provider_message_id)`; da idempotencia al webhook |
| `ai_chat_messages` | `org_id` |
| `agent_configs` | `org_id` único (una configuración por org) |
| `agent_jobs` | Cola de trabajo. Indexada por estado/org (**Supuesto**) |
| `agent_sessions` | `org_id` |
| `agent_messages` | **Solo índice por `session_id`** |
| `agent_suggestions` | Único parcial: una pendiente por sesión. **Sin índice por `org_id`** |
| `agent_events` | **Sin índice por `org_id`** |
| `listings` | Únicos parciales `(org_id, unit_id)`, `(org_id, slug)` y `(org_id, ref_code)` |
| `agent_advisor_settings`, `agent_availability`, `agent_availability_exceptions` | `org_id` |
| `property_visits` | `profile_id` restrict. `rescheduled_from_id` es FK a sí misma, set null. Constraint `EXCLUDE USING gist` contra solapes, definido solo en `0006_agent_visits.sql` |
| `calendar_connections` | `refresh_token_enc` y `access_token_enc` cifrados |
| `lead_pipeline_stages`, `lead_routing_members`, `lead_assignments`, `lead_followups` | `org_id` |
| `lead_listing_alerts` | Único `(lead_id, listing_id)`. **Sin índice por `org_id`** |
| `qa_exports` | `org_id` |
| `agent_web_sessions` | `token_hash` (sha256) único. `ip_hash` |
| `agent_web_handoff_codes` | `org_id` |
| `agent_web_usage_daily` | PK compuesta `(org_id, day)` |
| `agent_calls` | `vapi_call_id` único. Índice de deduplicación. Contiene `transcript` y `recording_url` |
| `voice_do_not_call` | PK compuesta `(org_id, phone_e164)` |
| `agent_session_listings` | PK `(session_id, listing_id)`. **Sin índice por `org_id`** |

### 3.7 Resumen de huecos de scoping

| Hueco | Tablas |
|---|---|
| Sin columna `org_id` | `import_rows` (scope indirecto por FK cascade); `users`, `accounts`, `sessions`, `verification_tokens` (globales por diseño) |
| Con `org_id` pero sin índice que empiece por `org_id` | `import_logs`, `agent_messages`, `agent_suggestions`, `agent_events`, `tenant_invitations`, `property_weekly_summaries`, `lead_listing_alerts`, `agent_session_listings` |

En las tablas de la segunda fila, la mayoría de las consultas filtran primero por una FK indexada (sesión, tenant o propiedad). El impacto actual es de rendimiento, no de seguridad. Las consultas de listado por organización harán un *seq scan* cuando crezcan los datos.

---

## 4. Modelo de autenticación

### 4.1 Proveedores y sesiones

- NextAuth v5 (`src/auth.ts`) con `DrizzleAdapter` y estrategia de sesión **database**. `trustHost: true`. La página de login es `/login`.
- `getSessionAndUser` del adaptador está envuelto en `withDbRetry`. Así una conexión caducada al reanudar la máquina no cierra la sesión.
- **Google**: `allowDangerousEmailAccountLinking: true`, `access_type: offline`, `prompt: select_account`.
  - `events.linkAccount` pone `password_hash` a null al vincular Google. Esto evita la toma de cuenta por pre-registro con contraseña.
  - `events.createUser` aprovisiona una org nueva con perfil `admin`. Si el email está en `ADMIN_ALLOWLIST`, lo adjunta como admin a la org de `PRIMARY_OWNER_EMAIL`.
- **Email/contraseña**: no se usa el proveedor Credentials. Las server actions de `src/app/actions/auth.ts` hacen el flujo:
  - `registerWithEmail`: valida con Zod y hashea con **bcryptjs, coste 12**. Crea usuario, org y perfil. Los emails en la allowlist reciben `USE_GOOGLE`.
  - `signInWithPassword`: compara en tiempo constante. Si el usuario no existe, compara contra un hash ficticio, lo que evita un oráculo de enumeración por tiempo.
  - `createUserSession`: token aleatorio de 32 bytes en hex, insertado en `sessions` con expiración de 30 días.
- **Cookie de sesión**: nombre `__Secure-authjs.session-token` en producción (`authjs.session-token` sin HTTPS). Flags: `HttpOnly`, `SameSite=Lax`, `Secure` en producción, `Path=/`. Expira a los 30 días.
- El callback `session` devuelve null si el usuario no tiene perfil. Así un usuario sin org no obtiene sesión válida de aplicación.

### 4.2 Roles y autorización

- `profiles.role` admite `admin` o `tenant`. Cada usuario tiene un solo perfil y una sola org (`user_id` único).
- `requireAdmin`: área `/dashboard` y operaciones de gestión. `requireTenant`: portal `/portal`. `requireUser`: ambos roles, con filtros extra de propiedad.
- Invitaciones: el token viaja en el enlace y en BD solo se guarda su sha256. `invite/accept` rechaza con 409 `ALREADY_IN_ORG` a usuarios que ya pertenecen a otra org.

### 4.3 Debilidades conocidas

- No hay verificación de email: `email_verified` queda null en registros con contraseña.
- No hay recuperación de contraseña: `requestPasswordReset` devuelve `NOT_IMPLEMENTED`.
- El rate limit es en memoria y por instancia (5 intentos cada 10 s por IP en login/registro). Se pierde al suspender la máquina.
- Las acciones de auth toman la **primera** IP de `x-forwarded-for`, que el cliente puede falsificar. `getClientIp` (usado en rutas API) prefiere `fly-client-ip` y luego la última IP del XFF.

---

## 5. Datos sensibles

| Dato | Tabla.columna | Protección |
|---|---|---|
| Contraseña | `users.password_hash` | bcrypt coste 12. Nunca se devuelve en DTOs |
| Tokens Google Calendar | `calendar_connections.refresh_token_enc`, `access_token_enc` | AES-256-GCM (`src/lib/crypto/encrypt.ts`, clave `TOKEN_ENCRYPTION_KEY`). Formato base64(iv 12 B ‖ tag 16 B ‖ ciphertext) |
| Tokens OAuth de login | `accounts.access_token`, `refresh_token`, `id_token` | **Texto plano** (comportamiento estándar del adaptador NextAuth) |
| Token de sesión | `sessions.session_token` | Texto plano (valor aleatorio de 256 bits) |
| Token de invitación | `tenant_invitations.token_hash` | sha256 |
| Token de sesión widget | `agent_web_sessions.token_hash`, `ip_hash` | sha256. La IP no se guarda en claro |
| Token de firma | `signature_requests.token` | **UUID en texto plano**. Con lectura de la BD se puede firmar |
| DNI y fecha de nacimiento | `tenants.document_number`, `tenants.date_of_birth`; `owners.dni`; `responsables.dni` | Texto plano. Protegidos solo por el scoping de org |
| Datos bancarios | `deposit_accounts.numero_cuenta`, `deposit_accounts.cci` | Texto plano |
| Grabaciones y transcripciones | `agent_calls.transcript`, `agent_calls.recording_url` | Texto plano. Acceso a la grabación solo con `requireAdmin` |
| Archivos (comprobantes, contratos, firmas, fotos) | Tigris | Buckets privados. Acceso solo por URL firmada de corta duración, tras pasar el guard |
| Conversaciones WhatsApp / agente | `whatsapp_messages`, `agent_messages` | Texto plano. Scope por org |

El contexto enviado a Anthropic para el resumen ejecutivo contiene solo KPIs agregados, sin PII. El OCR envía la imagen del comprobante completa.

---

## 6. Migraciones y seed

### 6.1 Convención

- Archivos SQL escritos a mano en `src/lib/db/migrations/` con el nombre `NNNN_descripcion.sql` (regex `^\d{4}_.+\.sql$`). Existen `0000_baseline.sql` a `0012_org_channels_whatsapp_unique.sql`.
- Las aplica `scripts/migrate.mjs`, que corre como `release_command` de Fly en cada deploy:
  1. Toma `pg_advisory_lock(727001)` para evitar ejecuciones concurrentes.
  2. Crea `public.schema_migrations(filename text PK, applied_at timestamptz)` si no existe.
  3. Si la base ya tenía `organizations` antes de existir el runner, registra `0000_baseline.sql`, `0001_missing_airtable_tables.sql` y `0002_tenant_statement_view.sql` como aplicadas, sin ejecutarlas.
  4. Ejecuta los archivos pendientes en orden lexicográfico. Cada archivo corre en su propia transacción junto con su fila de tracking.
  5. Ante cualquier error, el proceso sale con código 1. Fly aborta el deploy y mantiene la versión anterior.
- `connect_timeout` 30 s. `MIGRATIONS_DIR` permite cambiar el directorio en tests.
- **Nunca usar `drizzle-kit push`.** El constraint `EXCLUDE USING gist` de `property_visits` solo existe en `0006_agent_visits.sql`. Drizzle no lo modela y lo eliminaría.
- Al cambiar `schema.ts`, sigue estos pasos en orden:
  1. Escribe la migración SQL equivalente con el siguiente número.
  2. Hazla idempotente con `IF NOT EXISTS` donde aplique.
  3. Mantén el esquema TypeScript y el SQL sincronizados a mano.
- Los tests SQL se ejecutan con PGlite.

### 6.2 Seed

No existe script de seed en el repositorio: no hay `scripts/seed*`. El seed anterior estaba roto y se eliminó al retirar Supabase. Los datos de desarrollo provienen de la sincronización con Airtable (`/api/admin/integrations/airtable/sync`) y de las importaciones CSV (plantillas en `/api/admin/*/import/template`). Un entorno nuevo arranca así: crea la base, ejecuta `node scripts/migrate.mjs` y registra el primer usuario, que crea su organización automáticamente.
