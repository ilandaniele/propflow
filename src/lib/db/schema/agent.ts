import { sqliteTable, text, integer, uniqueIndex, index, check } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import type { AgentAttribution } from '@/lib/agent/types';
import { id, json, ts, money, bool } from './columns';
import { crmLeads, organizations, profiles, properties, units, whatsappConversations, whatsappMessages } from './core';

export const orgChannels = sqliteTable('org_channels', {
  id:         id(),
  orgId:      text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  channel:    text('channel').notNull(),      // 'whatsapp' | 'web' | 'voice'
  externalId: text('external_id').notNull(),  // phone_number_id | widget public key | voice number
  config:     json<unknown>('config').notNull().default({}),
  createdAt:  ts('created_at').notNull().$defaultFn(() => new Date()),
  updatedAt:  ts('updated_at').notNull().$defaultFn(() => new Date()),
}, (t) => [
  uniqueIndex('org_channels_channel_external_id').on(t.channel, t.externalId),
  index('idx_org_channels_org').on(t.orgId),
  // Agent Phase 7: resolveWebChannel()/getOrgWebChannel() assume exactly one
  // 'web' row per org.
  uniqueIndex('org_channels_one_web_per_org').on(t.orgId).where(sql`channel = 'web'`),
  // saveWhatsAppChannel() (src/app/actions/agent-setup.ts) assumes exactly one
  // 'whatsapp' row per org (migration 0012).
  uniqueIndex('org_channels_one_whatsapp_per_org').on(t.orgId).where(sql`channel = 'whatsapp'`),
  uniqueIndex('org_channels_one_voice_per_org').on(t.orgId).where(sql`channel = 'voice'`),
]);

export const agentJobs = sqliteTable('agent_jobs', {
  id:          id(),
  orgId:       text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  kind:        text('kind').notNull(),
  runAt:       ts('run_at').notNull().$defaultFn(() => new Date()),
  payload:     json<unknown>('payload').notNull().default({}),
  status:      text('status').notNull().default('pending'), // 'pending'|'processing'|'done'|'failed'
  attempts:    integer('attempts').notNull().default(0),
  lastError:   text('last_error'),
  lockedUntil: ts('locked_until'),
  createdAt:   ts('created_at').notNull().$defaultFn(() => new Date()),
  updatedAt:   ts('updated_at').notNull().$defaultFn(() => new Date()),
}, (t) => [
  index('idx_agent_jobs_due').on(t.status, t.runAt),
  index('idx_agent_jobs_org').on(t.orgId),
]);

export const agentConfigs = sqliteTable('agent_configs', {
  id:                    id(),
  orgId:                 text('org_id').notNull().unique().references(() => organizations.id, { onDelete: 'cascade' }),
  persona:               text('persona').notNull().default('Asistente inmobiliario'),
  tone:                  text('tone').notNull().default('profesional'), // 'profesional'|'cercano'|'formal'
  rules:                 text('rules'),
  prohibited:            text('prohibited'),
  faq:                   json<unknown>('faq').notNull().default([]),
  businessHours:         json<unknown>('business_hours').notNull().default({}),
  timezone:              text('timezone').notNull().default('America/Lima'),
  qualificationFields:   json<unknown>('qualification_fields').notNull()
    .default(['operation_type', 'zones', 'budget_max', 'bedrooms_min', 'timeline']),
  followupPolicy:        json<unknown>('followup_policy').notNull().default({}),
  routingMode:           text('routing_mode').notNull().default('round_robin'), // 'round_robin'|'weighted'|'manual'
  dailyTokenBudget:      integer('daily_token_budget').notNull().default(50_000),
  widgetAllowedOrigins:  json<unknown>('widget_allowed_origins').notNull().default([]),
  channelsEnabled:       json<unknown>('channels_enabled').notNull()
    .default({ whatsapp: false, web: false, voice: false }),
  shadowMode:            bool('shadow_mode').notNull().default(false),
  maxAgentTurns:         integer('max_agent_turns').default(30),
  // Agent Phase 7: public catalogue pages (src/app/p/**) are opt-in per org —
  // syncListingsFromUnits() inserts published=true rows, so without this gate
  // turning on the widget would also expose every synced unit's page.
  publicPagesEnabled:    bool('public_pages_enabled').notNull().default(false),
  // Agent Phase 8: voice AI (Vapi) config — see src/lib/agent/config-schema.ts's VoiceConfig.
  voiceConfig:           json<unknown>('voice_config').notNull().default({}),
  // Agent Phase 9: settings/metrics — the two remaining per-org limits.
  maxActiveVisitsPerPhone: integer('max_active_visits_per_phone').notNull().default(2),
  maxListingPhotos:      integer('max_listing_photos').notNull().default(5),
  createdAt:             ts('created_at').notNull().$defaultFn(() => new Date()),
  updatedAt:             ts('updated_at').notNull().$defaultFn(() => new Date()),
}, () => [
  check('agent_configs_tone_check', sql`tone IN ('profesional','cercano','formal')`),
  check('agent_configs_routing_mode_check', sql`routing_mode IN ('round_robin','weighted','manual')`),
  check('agent_configs_daily_token_budget_check', sql`daily_token_budget > 0`),
  check('agent_configs_max_agent_turns_check', sql`max_agent_turns IS NULL OR max_agent_turns > 0`),
  check('agent_configs_max_active_visits_per_phone_check', sql`max_active_visits_per_phone BETWEEN 1 AND 10`),
  check('agent_configs_max_listing_photos_check', sql`max_listing_photos BETWEEN 1 AND 10`),
]);

export const agentSessions = sqliteTable('agent_sessions', {
  id:                     id(),
  orgId:                  text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  channel:                text('channel').notNull(), // 'whatsapp'|'web'|'voice'
  externalId:             text('external_id').notNull(),
  leadId:                 text('lead_id').references(() => crmLeads.id, { onDelete: 'set null' }),
  whatsappConversationId: text('whatsapp_conversation_id').references(() => whatsappConversations.id, { onDelete: 'set null' }),
  mode:                   text('mode').notNull().default('ai'), // 'ai'|'human'|'paused'
  summary:                text('summary'),
  windowExpiresAt:        ts('window_expires_at'),
  processingLockedUntil:  ts('processing_locked_until'),
  // Agent Phase 2: turn cap, language, attribution and handoff bookkeeping.
  agentTurnCount:         integer('agent_turn_count').notNull().default(0),
  language:               text('language'), // 'es'|'en'|'pt'
  attribution:            json<AgentAttribution | null>('attribution'),
  handoffReason:          text('handoff_reason'), // 'tool'|'budget'|'turn_cap'|'manual'
  lastInboundAt:          ts('last_inbound_at'),
  lastAgentTurnAt:        ts('last_agent_turn_at'),
  createdAt:              ts('created_at').notNull().$defaultFn(() => new Date()),
  updatedAt:              ts('updated_at').notNull().$defaultFn(() => new Date()),
}, (t) => [
  uniqueIndex('uq_agent_sessions_channel_external').on(t.orgId, t.channel, t.externalId),
  index('idx_agent_sessions_org').on(t.orgId),
  index('idx_agent_sessions_lead').on(t.leadId),
  index('idx_agent_sessions_org_inbound').on(t.orgId, t.lastInboundAt),
  index('idx_agent_sessions_org_channel_created').on(t.orgId, t.channel, t.createdAt),
  check('agent_sessions_channel_check', sql`channel IN ('whatsapp','web','voice')`),
  check('agent_sessions_mode_check', sql`mode IN ('ai','human','paused')`),
  check('agent_sessions_language_check', sql`language IS NULL OR language IN ('es','en','pt')`),
  check('agent_sessions_handoff_reason_check', sql`handoff_reason IS NULL OR handoff_reason IN ('tool','budget','turn_cap','manual')`),
]);

export const agentMessages = sqliteTable('agent_messages', {
  id:           id(),
  orgId:        text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  sessionId:    text('session_id').notNull().references(() => agentSessions.id, { onDelete: 'cascade' }),
  role:         text('role').notNull(), // 'user'|'assistant'
  content:      json<unknown>('content').notNull(),
  inputTokens:  integer('input_tokens'),
  outputTokens: integer('output_tokens'),
  costUsd:      money('cost_usd'),
  // OVERRIDE (Phase 2, item A): null|'sent' rows count toward LLM history;
  // 'shadow_pending' (unreviewed shadow-mode draft) and 'shadow_discarded'
  // (rejected draft) are filtered out by getSessionHistory(). See
  // handoffs/phase2-blueprint.md item A "Override" note.
  sendStatus:   text('send_status'),
  createdAt:    ts('created_at').notNull().$defaultFn(() => new Date()),
}, (t) => [
  index('idx_agent_messages_session').on(t.sessionId, t.createdAt),
  index('idx_agent_messages_org_created').on(t.orgId, t.createdAt),
  check('agent_messages_role_check', sql`role IN ('user','assistant')`),
  check('agent_messages_send_status_check', sql`send_status IS NULL OR send_status IN ('sent','shadow_pending','shadow_discarded')`),
]);

export const listings = sqliteTable('listings', {
  id:              id(),
  orgId:           text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  unitId:          text('unit_id').references(() => units.id, { onDelete: 'set null' }),
  propertyId:      text('property_id').references(() => properties.id, { onDelete: 'set null' }),
  operation:       text('operation').notNull(), // 'rent'|'sale'
  price:           money('price'),
  currency:        text('currency').notNull().default('PEN'),
  status:          text('status').notNull().default('available'), // 'available'|'reserved'|'closed'
  statusOverride:  bool('status_override').notNull().default(false),
  title:           text('title'),
  description:     text('description'),
  zone:            text('zone'),
  bedrooms:        integer('bedrooms'),
  bathrooms:       integer('bathrooms'),
  areaM2:          money('area_m2'),
  parking:         bool('parking').notNull().default(false),
  maintenanceFee:  money('maintenance_fee'),
  petsAllowed:     bool('pets_allowed'),
  publicSlug:      text('public_slug'),
  published:       bool('published').notNull().default(false),
  // Phase 6 (0008): set by the trg_listings_published_at trigger + CHECK,
  // only in SQL — never write this column from app code.
  publishedAt:     ts('published_at'),
  refCode:         text('ref_code'),
  createdAt:       ts('created_at').notNull().$defaultFn(() => new Date()),
  updatedAt:       ts('updated_at').notNull().$defaultFn(() => new Date()),
}, (t) => [
  index('idx_listings_org').on(t.orgId),
  index('idx_listings_org_published').on(t.orgId, t.published, t.status),
  uniqueIndex('listings_org_unit_uniq').on(t.orgId, t.unitId).where(sql`unit_id IS NOT NULL`),
  uniqueIndex('listings_org_slug_uniq').on(t.orgId, t.publicSlug).where(sql`public_slug IS NOT NULL`),
  uniqueIndex('listings_org_ref_code_uniq').on(t.orgId, t.refCode).where(sql`ref_code IS NOT NULL`),
  check('listings_operation_check', sql`operation IN ('rent','sale')`),
  check('listings_price_check', sql`price IS NULL OR CAST(price AS REAL) >= 0`),
  check('listings_status_check', sql`status IN ('available','reserved','closed')`),
  check('listings_bedrooms_check', sql`bedrooms IS NULL OR bedrooms >= 0`),
  check('listings_bathrooms_check', sql`bathrooms IS NULL OR bathrooms >= 0`),
  check('listings_area_m2_check', sql`area_m2 IS NULL OR CAST(area_m2 AS REAL) >= 0`),
  check('listings_maintenance_fee_check', sql`maintenance_fee IS NULL OR CAST(maintenance_fee AS REAL) >= 0`),
  check('chk_listings_has_target', sql`unit_id IS NOT NULL OR property_id IS NOT NULL`),
]);

export const listingImages = sqliteTable('listing_images', {
  id:          id(),
  orgId:       text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  listingId:   text('listing_id').notNull().references(() => listings.id, { onDelete: 'cascade' }),
  storagePath: text('storage_path').notNull(),
  filename:    text('filename').notNull(),
  mimeType:    text('mime_type').notNull(),
  sizeBytes:   integer('size_bytes').notNull(),
  width:       integer('width'),
  height:      integer('height'),
  caption:     text('caption'),
  sortOrder:   integer('sort_order').notNull().default(0),
  isCover:     bool('is_cover').notNull().default(false),
  uploadedBy:  text('uploaded_by').references(() => profiles.id),
  createdAt:   ts('created_at').notNull().$defaultFn(() => new Date()),
}, (t) => [
  index('idx_listing_images_listing').on(t.listingId, t.sortOrder),
  index('idx_listing_images_org').on(t.orgId),
  uniqueIndex('listing_images_cover_idx').on(t.listingId).where(sql`is_cover = 1`),
]);

export const agentSuggestions = sqliteTable('agent_suggestions', {
  id:                     id(),
  orgId:                  text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  sessionId:              text('session_id').notNull().references(() => agentSessions.id, { onDelete: 'cascade' }),
  whatsappConversationId: text('whatsapp_conversation_id').references(() => whatsappConversations.id, { onDelete: 'set null' }),
  // OVERRIDE: the assistant turn (agent_messages row) this suggestion drafted.
  // Flips to send_status='sent' (approved, possibly with edited content) or
  // 'shadow_discarded' when decided — see getSessionHistory().
  agentMessageId:         text('agent_message_id').references(() => agentMessages.id, { onDelete: 'set null' }),
  body:                   text('body').notNull(),
  status:                 text('status').notNull().default('pending'), // 'pending'|'sending'|'sent'|'discarded'|'superseded'
  decidedBy:              text('decided_by').references(() => profiles.id, { onDelete: 'set null' }),
  decidedAt:              ts('decided_at'),
  sentMessageId:          text('sent_message_id').references(() => whatsappMessages.id, { onDelete: 'set null' }),
  createdAt:              ts('created_at').notNull().$defaultFn(() => new Date()),
}, (t) => [
  index('idx_agent_suggestions_session').on(t.sessionId, t.createdAt),
  uniqueIndex('agent_suggestions_one_pending').on(t.sessionId).where(sql`status = 'pending'`),
  check('agent_suggestions_status_check', sql`status IN ('pending','sending','sent','discarded','superseded')`),
]);

export const agentEvents = sqliteTable('agent_events', {
  id:              id(),
  orgId:           text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  sessionId:       text('session_id').notNull().references(() => agentSessions.id, { onDelete: 'cascade' }),
  kind:            text('kind').notNull(),
  data:            json<unknown>('data').notNull().default({}),
  actorProfileId:  text('actor_profile_id').references(() => profiles.id, { onDelete: 'set null' }),
  createdAt:       ts('created_at').notNull().$defaultFn(() => new Date()),
}, (t) => [
  index('idx_agent_events_session').on(t.sessionId, t.createdAt),
  index('idx_agent_events_org_kind_ts').on(t.orgId, t.kind, t.createdAt),
]);
