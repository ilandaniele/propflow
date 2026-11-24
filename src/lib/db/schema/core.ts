import { sqliteTable, text, integer, primaryKey, uniqueIndex, index, check } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { id, json, ts, money, dateStr, bool } from './columns';

export const users = sqliteTable('users', {
  id:            id(),
  name:          text('name'),
  email:         text('email').unique(),
  emailVerified: ts('email_verified'),
  image:         text('image'),
  // Credentials provider: PBKDF2 hash (legacy bcrypt rows are rehashed at login) stored here (never in plain text)
  passwordHash:  text('password_hash'),
});

export const accounts = sqliteTable(
  'accounts',
  {
    userId:            text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    type:              text('type').notNull(),
    provider:          text('provider').notNull(),
    providerAccountId: text('provider_account_id').notNull(),
    refreshToken:      text('refresh_token'),
    accessToken:       text('access_token'),
    expiresAt:         integer('expires_at'),
    tokenType:         text('token_type'),
    scope:             text('scope'),
    idToken:           text('id_token'),
    sessionState:      text('session_state'),
  },
  (t) => [
    primaryKey({ columns: [t.provider, t.providerAccountId] }),
  ],
);

export const sessions = sqliteTable('sessions', {
  sessionToken: text('session_token').primaryKey(),
  userId:       text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  expires:      ts('expires').notNull(),
});

export const verificationTokens = sqliteTable(
  'verification_tokens',
  {
    identifier: text('identifier').notNull(),
    token:      text('token').notNull(),
    expires:    ts('expires').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.identifier, t.token] }),
  ],
);

export const organizations = sqliteTable('organizations', {
  id:        id(),
  name:      text('name').notNull(),
  slug:      text('slug').unique(),
  createdAt: ts('created_at').notNull().$defaultFn(() => new Date()),
  updatedAt: ts('updated_at').notNull().$defaultFn(() => new Date()),
});

export const profiles = sqliteTable('profiles', {
  id:                id(),
  // NEW FK — replaces old profiles.id → auth.users(id)
  userId:            text('user_id').unique().references(() => users.id, { onDelete: 'cascade' }),
  orgId:             text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  role:              text('role').notNull(),  // 'admin' | 'tenant'
  fullName:          text('full_name'),
  email:             text('email'),
  phone:             text('phone'),
  preferredLanguage: text('preferred_language'),
  termsAcceptedAt:   ts('terms_accepted_at'),
  termsVersion:      text('terms_version'),
  privacyAcceptedAt: ts('privacy_accepted_at'),
  privacyVersion:    text('privacy_version'),
  createdAt:         ts('created_at').notNull().$defaultFn(() => new Date()),
  updatedAt:         ts('updated_at').notNull().$defaultFn(() => new Date()),
}, (t) => [
  index('idx_profiles_org_id').on(t.orgId),
  index('idx_profiles_org_role').on(t.orgId, t.role),
  check('profiles_role_check', sql`role IN ('admin', 'tenant')`),
  check('profiles_preferred_language_check', sql`preferred_language IN ('es', 'en', 'pt')`),
]);

export const staffRoles = sqliteTable('staff_roles', {
  id:        id(),
  orgId:     text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  profileId: text('profile_id').notNull().references(() => profiles.id, { onDelete: 'cascade' }),
  role:      text('role').notNull(),
  createdBy: text('created_by').references(() => profiles.id, { onDelete: 'set null' }),
  createdAt: ts('created_at').notNull().$defaultFn(() => new Date()),
  updatedAt: ts('updated_at').notNull().$defaultFn(() => new Date()),
}, (t) => [
  uniqueIndex('staff_roles_profile_uniq').on(t.profileId),
  index('idx_staff_roles_org').on(t.orgId),
  check('staff_roles_role_check', sql`role IN ('finance', 'operations', 'viewer')`),
]);

export const properties = sqliteTable('properties', {
  id:                 id(),
  orgId:              text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  name:               text('name').notNull(),
  address:            text('address'),
  city:               text('city'),
  country:            text('country'),
  airtableExternalId: text('airtable_external_id'),
  airtableSyncedAt:   ts('airtable_synced_at'),
  topeLuz:            money('tope_luz'),
  topeAgua:           money('tope_agua'),
  district:           text('district'),
  modality:           text('modality'),
  supplyNumberLuz:    text('supply_number_luz'),
  totalRooms:         integer('total_rooms'),
  currentResidents:   integer('current_residents'),
  description:        text('description'),
  codigoPagoInternet: text('codigo_pago_internet'),
  nClienteGas:        text('n_cliente_gas'),
  nSuministroAgua:    text('n_suministro_agua'),
  folderId:           text('folder_id'),
  gasType:            text('gas_type'),
  nPe:                text('n_pe'),
  createdAt:          ts('created_at').notNull().$defaultFn(() => new Date()),
  updatedAt:          ts('updated_at').notNull().$defaultFn(() => new Date()),
}, (t) => [
  index('idx_properties_org_id').on(t.orgId),
  uniqueIndex('properties_org_airtable_uniq').on(t.orgId, t.airtableExternalId),
]);

export const units = sqliteTable('units', {
  id:                  id(),
  orgId:               text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  propertyId:          text('property_id').notNull().references(() => properties.id, { onDelete: 'cascade' }),
  label:               text('label').notNull(),
  floor:               text('floor'),
  bedrooms:            integer('bedrooms'),
  monthlyRentDefault:  money('monthly_rent_default'),
  status:              text('status').notNull().default('vacant'),  // 'vacant' | 'occupied'
  toiletType:          text('toilet_type').notNull().default('private'),  // 'shared' | 'private' | 'none'
  airtableExternalId:  text('airtable_external_id'),
  airtableSyncedAt:    ts('airtable_synced_at'),
  areaM2:              money('area_m2'),
  unitType:            text('unit_type'),
  price6months:        money('price_6months'),
  price12months:       money('price_12months'),
  price18months:       money('price_18months'),
  createdAt:           ts('created_at').notNull().$defaultFn(() => new Date()),
  updatedAt:           ts('updated_at').notNull().$defaultFn(() => new Date()),
}, (t) => [
  index('idx_units_org_id').on(t.orgId),
  index('idx_units_org_status').on(t.orgId, t.status),
  index('idx_units_property_id').on(t.propertyId),
  uniqueIndex('units_org_airtable_uniq').on(t.orgId, t.airtableExternalId),
  check('units_bedrooms_check', sql`bedrooms >= 0`),
  check('units_monthly_rent_default_check', sql`CAST(monthly_rent_default AS REAL) >= 0`),
  check('units_status_check', sql`status IN ('vacant', 'occupied')`),
  check('units_toilet_type_check', sql`toilet_type IN ('shared', 'private', 'none')`),
]);

export const responsables = sqliteTable('responsables', {
  id:                 id(),
  orgId:              text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  airtableExternalId: text('airtable_external_id'),
  airtableSyncedAt:   ts('airtable_synced_at'),
  fullName:           text('full_name'),
  dni:                text('dni'),
  phone:              text('phone'),
  email:              text('email'),
  employment:         text('employment'),
  company:            text('company'),
  jobTitle:           text('job_title'),
  industry:           text('industry'),
  status:             text('status'),
  photoUrl:           text('photo_url'),
  createdAt:          ts('created_at').$defaultFn(() => new Date()),
  updatedAt:          ts('updated_at').$defaultFn(() => new Date()),
}, (t) => [
  uniqueIndex('responsables_org_airtable_uniq').on(t.orgId, t.airtableExternalId),
]);

export const tenants = sqliteTable('tenants', {
  id:                    id(),
  orgId:                 text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  profileId:             text('profile_id').references(() => profiles.id, { onDelete: 'set null' }),
  responsableId:         text('responsable_id').references(() => responsables.id, { onDelete: 'set null' }),
  fullName:              text('full_name').notNull(),
  email:                 text('email'),
  phone:                 text('phone'),
  unitId:                text('unit_id').references(() => units.id, { onDelete: 'set null' }),
  notes:                 text('notes'),
  preferredLanguage:     text('preferred_language').notNull().default('es'),
  photoUrl:              text('photo_url'),
  whatsappPhone:         text('whatsapp_phone'),
  whatsappOptIn:         bool('whatsapp_opt_in').notNull().default(false),
  reliabilityScores:     json<unknown>('reliability_scores').notNull().default({}),
  airtableExternalId:    text('airtable_external_id'),
  airtableSyncedAt:      ts('airtable_synced_at'),
  syncStatus:            text('sync_status').notNull().default('pending'),
  lastSyncedAt:          ts('last_synced_at'),
  portalAccess:          text('portal_access').notNull().default('not_invited'),
  emergencyContactName:  text('emergency_contact_name'),
  emergencyContactPhone: text('emergency_contact_phone'),
  externalTenantId:      text('external_tenant_id'),
  documentNumber:        text('document_number'),
  dateOfBirth:           dateStr('date_of_birth'),
  moveInDate:            dateStr('move_in_date'),
  importSource:          text('import_source').default('manual'),
  codigo:                text('codigo'),
  firstName:             text('first_name'),
  lastName:              text('last_name'),
  dni:                   text('dni'),
  birthDate:             dateStr('birth_date'),
  paymentDueDay:         integer('payment_due_day'),
  monthlyRent:           money('monthly_rent'),
  deposit:               money('deposit'),
  tenantStatus:          text('tenant_status'),
  contractStart:         dateStr('contract_start'),
  contractEnd:           dateStr('contract_end'),
  durationMonths:        integer('duration_months'),
  occupation:            text('occupation'),
  fotoTiuUrl:            text('foto_tiu_url'),
  solvencyDocUrl:        text('solvency_doc_url'),
  acquisitionChannels:   text('acquisition_channels'),
  exitReason:            text('exit_reason'),
  createdAt:             ts('created_at').notNull().$defaultFn(() => new Date()),
  updatedAt:             ts('updated_at').notNull().$defaultFn(() => new Date()),
}, (t) => [
  index('idx_tenants_org_id').on(t.orgId),
  index('idx_tenants_org_unit').on(t.orgId, t.unitId),
  index('idx_tenants_profile_id').on(t.profileId),
  uniqueIndex('tenants_org_airtable_uniq').on(t.orgId, t.airtableExternalId),
  uniqueIndex('tenants_org_external_id_uidx').on(t.orgId, t.externalTenantId),
  check('tenants_preferred_language_check', sql`preferred_language IN ('es', 'en', 'pt')`),
  check('tenants_sync_status_check', sql`sync_status IN ('pending','synced','failed','needs_review')`),
  check('tenants_portal_access_check', sql`portal_access IN ('not_invited','invited','active')`),
]);

export const contracts = sqliteTable('contracts', {
  id:                 id(),
  orgId:              text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  tenantId:           text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  unitId:             text('unit_id').notNull().references(() => units.id, { onDelete: 'cascade' }),
  startDate:          dateStr('start_date').notNull(),
  endDate:            dateStr('end_date'),  // nullable — open-ended contracts (migration 052)
  monthlyRent:        money('monthly_rent').notNull(),
  status:             text('status').notNull().default('active'),  // 'active' | 'expired' | 'terminated'
  deposit:            money('deposit'),
  documentUrl:        text('document_url'),
  signedAt:           ts('signed_at'),
  signatureStatus:    text('signature_status'),  // 'pending_signature' | 'signed' | 'declined'
  airtableExternalId: text('airtable_external_id'),
  airtableSyncedAt:   ts('airtable_synced_at'),
  contractCode:       text('contract_code'),
  contractType:       text('contract_type'),
  durationMonths:     integer('duration_months'),
  depositReceiptUrl:  text('deposit_receipt_url'),
  actualExitDate:     dateStr('actual_exit_date'),
  signedContractUrl:  text('signed_contract_url'),
  exitReason:         text('exit_reason'),
  penaltyApplied:     bool('penalty_applied'),
  penaltyAmount:      money('penalty_amount'),
  depositReturned:    money('deposit_returned'),
  exitDebt:           money('exit_debt'),
  cleaningFeeStatus:  text('cleaning_fee_status'),
  hasGlp:             bool('has_glp'),
  actualCloseDate:    dateStr('actual_close_date'),
  keynuaContractId:   text('keynua_contract_id'),
  paymentStatus:      text('payment_status'),
  createdAt:          ts('created_at').notNull().$defaultFn(() => new Date()),
  updatedAt:          ts('updated_at').notNull().$defaultFn(() => new Date()),
}, (t) => [
  index('idx_contracts_org_id').on(t.orgId),
  index('idx_contracts_tenant_id').on(t.tenantId),
  index('idx_contracts_unit_id').on(t.unitId),
  index('idx_contracts_org_status').on(t.orgId, t.status),
  uniqueIndex('contracts_org_airtable_uniq').on(t.orgId, t.airtableExternalId),
  check('contracts_monthly_rent_check', sql`CAST(monthly_rent AS REAL) > 0`),
  check('contracts_status_check', sql`status IN ('active', 'expired', 'terminated')`),
  check('contracts_deposit_check', sql`CAST(deposit AS REAL) >= 0`),
  check('contracts_signature_status_check', sql`signature_status IS NULL OR signature_status IN ('pending_signature','signed','declined')`),
  check('contracts_date_order_nullable', sql`end_date IS NULL OR end_date > start_date`),
]);

export const whatsappConversations = sqliteTable('whatsapp_conversations', {
  id:               id(),
  orgId:            text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  tenantId:         text('tenant_id').references(() => tenants.id, { onDelete: 'set null' }),
  externalPhone:    text('external_phone').notNull(),
  lastMessageAt:    ts('last_message_at'),
  unreadCountAdmin: integer('unread_count_admin').notNull().default(0),
  createdAt:        ts('created_at').notNull().$defaultFn(() => new Date()),
  updatedAt:        ts('updated_at').notNull().$defaultFn(() => new Date()),
}, (t) => [
  index('idx_wa_conv_org_last').on(t.orgId, t.lastMessageAt),
  index('idx_wa_conv_tenant').on(t.tenantId),
  uniqueIndex('whatsapp_conversations_phone_per_org').on(t.orgId, t.externalPhone),
]);

export const whatsappMessages = sqliteTable('whatsapp_messages', {
  id:                id(),
  orgId:             text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  conversationId:    text('conversation_id').notNull().references(() => whatsappConversations.id, { onDelete: 'cascade' }),
  direction:         text('direction').notNull(),  // 'inbound' | 'outbound'
  providerMessageId: text('provider_message_id'),
  body:              text('body'),
  attachmentPath:    text('attachment_path'),
  attachmentKind:    text('attachment_kind'),    // 'image'|'document'|'audio'|'video'
  classification:    text('classification'),     // 'receipt'|'task-proof'|'incident-evidence'|'other'
  status:            text('status').notNull().default('received'),
  meta:              json<unknown>('meta').notNull().default({}),
  // Agent Phase 2: per-message claim/debounce + sender attribution for the inbox.
  agentStatus:       text('agent_status'),           // null (tenant/disabled) | 'pending'|'processing'|'processed'|'skipped'
  senderKind:        text('sender_kind'),             // 'contact'|'agent'|'human'|'system'
  sentByProfileId:   text('sent_by_profile_id').references(() => profiles.id, { onDelete: 'set null' }),
  // Item 4: when this row was claimed ('pending' → 'processing') — lets the
  // sweeper tell a crashed turn (stuck 'processing') apart from one still in
  // flight, so it can resurrect the former back to 'pending'.
  agentClaimedAt:    ts('agent_claimed_at'),
  createdAt:         ts('created_at').notNull().$defaultFn(() => new Date()),
}, (t) => [
  index('idx_wa_msg_conv').on(t.conversationId, t.createdAt),
  index('idx_wa_msg_org_status').on(t.orgId, t.status, t.createdAt),
  // Plain unique index, not a deferrable constraint (see migration 0005) — Postgres
  // requires a non-deferrable arbiter for insertMessage()'s onConflictDoNothing.
  uniqueIndex('whatsapp_messages_provider_id_per_org').on(t.orgId, t.providerMessageId),
  index('idx_wa_msg_agent_pending').on(t.conversationId, t.createdAt)
    .where(sql`agent_status IN ('pending','processing')`),
  index('idx_wa_msg_conv_dir_created').on(t.conversationId, t.direction, t.createdAt),
  check('whatsapp_messages_direction_check', sql`direction IN ('inbound', 'outbound')`),
  check('whatsapp_messages_attachment_kind_check', sql`attachment_kind IN ('image', 'document', 'audio', 'video')`),
  check('whatsapp_messages_classification_check', sql`classification IN ('receipt', 'task-proof', 'incident-evidence', 'other')`),
  check('whatsapp_messages_status_check', sql`status IN ('queued','sent','delivered','read','failed','received')`),
  check('whatsapp_messages_agent_status_check', sql`agent_status IS NULL OR agent_status IN ('pending','processing','processed','skipped')`),
  check('whatsapp_messages_sender_kind_check', sql`sender_kind IS NULL OR sender_kind IN ('contact','agent','human','system')`),
]);

export const crmLeads = sqliteTable('crm_leads', {
  id:               id(),
  orgId:            text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  fullName:         text('full_name').notNull(),
  email:            text('email'),
  phone:            text('phone'),
  propertyInterest: text('property_interest'),
  source:           text('source'),
  status:           text('status').notNull().default('new'),  // 'new'|'contacted'|'qualified'|'lost'
  notes:            text('notes'),
  // Agent qualification fields (Phase 1). `status` above is left untouched —
  // dashboard/leads still reads it; `stage` is the agent's richer pipeline.
  operationType:      text('operation_type'),      // 'rent'|'buy'|'owner_sell'|'owner_rent'
  pipeline:           text('pipeline').notNull().default('demand'), // 'demand'|'supply'
  budgetMin:          money('budget_min'),
  budgetMax:          money('budget_max'),
  currency:           text('currency').notNull().default('PEN'),
  zones:              json<string[]>('zones').notNull().default([]),
  bedroomsMin:        integer('bedrooms_min'),
  moveInDate:         dateStr('move_in_date'),
  timeline:           text('timeline'), // 'immediate'|'1_3_months'|'3_6_months'|'flexible'
  pets:               bool('pets'),
  score:              integer('score').notNull().default(0),
  intentTag:          text('intent_tag'), // 'high_intent'|'under_analysis'|'qualified'|'cold'
  assignedProfileId:  text('assigned_profile_id').references(() => profiles.id, { onDelete: 'set null' }),
  stage:              text('stage').notNull().default('new'),
  // Phase 6 (0008): free-form per-org stage key (CHECK crm_leads_stage_format
  // in SQL — matches /^[a-z][a-z0-9_]{1,39}$/), no longer a fixed enum. See
  // src/lib/leads/types.ts SYSTEM_STAGES for the seeded defaults per pipeline.
  nextFollowupAt:     ts('next_followup_at'),
  doNotContact:       bool('do_not_contact').notNull().default(false),
  sourceChannel:      text('source_channel'), // 'whatsapp'|'web'|'voice'|'manual'
  sourceRef:          text('source_ref'),
  sourceMeta:         json<Record<string, unknown>>('source_meta').notNull().default({}),
  // Phase 6 (0008): routing/pipeline bookkeeping.
  assignedAt:         ts('assigned_at'),
  stageChangedAt:     ts('stage_changed_at'),
  followupState:      text('followup_state').notNull().default('idle'), // 'idle'|'active'|'stopped'|'completed'
  followupStopReason: text('followup_stop_reason'),
  lastListingAlertAt: ts('last_listing_alert_at'),
  createdAt:        ts('created_at').notNull().$defaultFn(() => new Date()),
  updatedAt:        ts('updated_at').notNull().$defaultFn(() => new Date()),
}, (t) => [
  index('idx_crm_leads_org').on(t.orgId),
  index('idx_crm_leads_org_status').on(t.orgId, t.status),
  index('idx_crm_leads_org_stage').on(t.orgId, t.stage),
  index('idx_crm_leads_org_followup').on(t.orgId, t.nextFollowupAt),
  index('idx_crm_leads_org_pipeline_stage').on(t.orgId, t.pipeline, t.stage),
  index('idx_crm_leads_org_assigned').on(t.orgId, t.assignedProfileId),
  index('idx_crm_leads_org_created').on(t.orgId, t.createdAt),
  check('crm_leads_status_check', sql`status IN ('new','contacted','qualified','lost')`),
  check('crm_leads_operation_type_check', sql`operation_type IS NULL OR operation_type IN ('rent','buy','owner_sell','owner_rent')`),
  check('crm_leads_pipeline_check', sql`pipeline IN ('demand','supply')`),
  check('crm_leads_budget_min_check', sql`budget_min IS NULL OR CAST(budget_min AS REAL) >= 0`),
  check('crm_leads_budget_max_check', sql`budget_max IS NULL OR CAST(budget_max AS REAL) >= 0`),
  check('crm_leads_bedrooms_min_check', sql`bedrooms_min IS NULL OR bedrooms_min >= 0`),
  check('crm_leads_timeline_check', sql`timeline IS NULL OR timeline IN ('immediate','1_3_months','3_6_months','flexible')`),
  check('crm_leads_intent_tag_check', sql`intent_tag IS NULL OR intent_tag IN ('high_intent','under_analysis','qualified','cold')`),
  check('crm_leads_source_channel_check', sql`source_channel IS NULL OR source_channel IN ('whatsapp','web','voice','manual')`),
  check('crm_leads_stage_format', sql`(length(stage) BETWEEN 2 AND 40 AND stage GLOB '[a-z]*' AND stage NOT GLOB '*[^a-z0-9_]*')`),
  check('crm_leads_followup_state_check', sql`followup_state IN ('idle', 'active', 'stopped', 'completed')`),
]);

export const rateLimits = sqliteTable('rate_limits', {
  key:         text('key').primaryKey(),
  count:       integer('count').notNull(),
  windowStart: integer('window_start').notNull(),
});
