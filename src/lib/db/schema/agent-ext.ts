import { sqliteTable, text, integer, primaryKey, uniqueIndex, index, check, type AnySQLiteColumn } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { id, json, ts, money, dateStr, bool } from './columns';
import { agentSessions, listings } from './agent';
import { contracts, crmLeads, organizations, profiles, tenants } from './core';

export const agentAdvisorSettings = sqliteTable('agent_advisor_settings', {
  id:               id(),
  orgId:            text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  profileId:        text('profile_id').notNull().references(() => profiles.id, { onDelete: 'cascade' }),
  acceptsVisits:    bool('accepts_visits').notNull().default(true),
  visitMinutes:     integer('visit_minutes').notNull().default(45),
  bufferMinutes:    integer('buffer_minutes').notNull().default(15),
  minNoticeMinutes: integer('min_notice_minutes').notNull().default(120),
  daysAhead:        integer('days_ahead').notNull().default(14),
  slotStepMinutes:  integer('slot_step_minutes').notNull().default(30),
  createdAt:        ts('created_at').notNull().$defaultFn(() => new Date()),
  updatedAt:        ts('updated_at').notNull().$defaultFn(() => new Date()),
}, (t) => [
  uniqueIndex('agent_advisor_settings_org_profile_uidx').on(t.orgId, t.profileId),
  check('agent_advisor_settings_visit_minutes_check', sql`visit_minutes BETWEEN 10 AND 240`),
  check('agent_advisor_settings_buffer_minutes_check', sql`buffer_minutes BETWEEN 0 AND 120`),
  check('agent_advisor_settings_min_notice_minutes_check', sql`min_notice_minutes >= 0`),
  check('agent_advisor_settings_days_ahead_check', sql`days_ahead BETWEEN 1 AND 60`),
  check('agent_advisor_settings_slot_step_minutes_check', sql`slot_step_minutes IN (15, 30, 60)`),
]);

export const agentAvailability = sqliteTable('agent_availability', {
  id:          id(),
  orgId:       text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  profileId:   text('profile_id').notNull().references(() => profiles.id, { onDelete: 'cascade' }),
  weekday:     integer('weekday').notNull(),      // 0 = Sunday, same as Date#getDay — SMALLINT in SQL
  startMinute: integer('start_minute').notNull(), // minutes since local midnight
  endMinute:   integer('end_minute').notNull(),
  createdAt:   ts('created_at').notNull().$defaultFn(() => new Date()),
}, (t) => [
  index('idx_agent_availability_org_profile').on(t.orgId, t.profileId),
  check('agent_availability_weekday_check', sql`weekday BETWEEN 0 AND 6`),
  check('agent_availability_start_minute_check', sql`start_minute BETWEEN 0 AND 1439`),
  check('agent_availability_end_minute_check', sql`end_minute BETWEEN 1 AND 1440`),
  check('agent_availability_end_after_start', sql`end_minute > start_minute`),
]);

export const agentAvailabilityExceptions = sqliteTable('agent_availability_exceptions', {
  id:                  id(),
  orgId:               text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  profileId:           text('profile_id').notNull().references(() => profiles.id, { onDelete: 'cascade' }),
  startsAt:            ts('starts_at').notNull(),
  endsAt:              ts('ends_at').notNull(),
  kind:                text('kind').notNull(), // 'block' | 'extra'
  reason:              text('reason'),
  createdByProfileId:  text('created_by_profile_id').references(() => profiles.id, { onDelete: 'set null' }),
  createdAt:           ts('created_at').notNull().$defaultFn(() => new Date()),
}, (t) => [
  index('idx_agent_availability_exceptions_org_profile_starts').on(t.orgId, t.profileId, t.startsAt),
  check('agent_availability_exceptions_kind_check', sql`kind IN ('block', 'extra')`),
  check('agent_availability_exceptions_ends_after_starts', sql`ends_at > starts_at`),
]);

// NOTE: the `property_visits_no_overlap` EXCLUDE USING gist constraint is
// declared only in 0006_agent_visits.sql — Drizzle has no EXCLUDE constraint
// builder, and this table must NEVER be pushed with `drizzle-kit push`
// (it would silently drop the constraint).
export const propertyVisits = sqliteTable('property_visits', {
  id:                   id(),
  orgId:                text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  leadId:               text('lead_id').notNull().references(() => crmLeads.id, { onDelete: 'cascade' }),
  listingId:            text('listing_id').references(() => listings.id, { onDelete: 'set null' }),
  profileId:            text('profile_id').notNull().references(() => profiles.id, { onDelete: 'restrict' }),
  sessionId:            text('session_id').references(() => agentSessions.id, { onDelete: 'set null' }),
  contactPhone:         text('contact_phone'),
  startsAt:             ts('starts_at').notNull(),
  endsAt:               ts('ends_at').notNull(),
  blockedUntil:         ts('blocked_until').notNull(),
  status:               text('status').notNull().default('scheduled'),
  // 'scheduled'|'confirmed'|'completed'|'no_show'|'cancelled'|'rescheduled'
  createdBy:            text('created_by').notNull(), // 'agent'|'human'
  createdByProfileId:   text('created_by_profile_id').references(() => profiles.id, { onDelete: 'set null' }),
  sourceChannel:        text('source_channel').notNull(), // 'whatsapp'|'web'|'voice'|'manual'
  rescheduledFromId:    text('rescheduled_from_id').references((): AnySQLiteColumn => propertyVisits.id, { onDelete: 'set null' }),
  googleEventId:        text('google_event_id'), // Phase 5
  // Phase 5 (0007): Google Calendar sync bookkeeping.
  googleConnectionId:   text('google_connection_id').references((): AnySQLiteColumn => calendarConnections.id, { onDelete: 'set null' }),
  googleSyncStatus:     text('google_sync_status').notNull().default('none'),
  // 'none'|'pending'|'synced'|'error'|'detached'|'drift'
  googleEventEtag:      text('google_event_etag'),
  googleSyncedAt:       ts('google_synced_at'),
  googleSyncError:      text('google_sync_error'),
  googleDriftStartsAt:  ts('google_drift_starts_at'),
  googleDriftEndsAt:    ts('google_drift_ends_at'),
  notes:                text('notes'),
  cancelReason:         text('cancel_reason'),
  feedback:             text('feedback'), // 'interested'|'not_interested'|'wants_more'
  outcomeSource:        text('outcome_source'), // 'staff'|'lead'
  confirmedAt:          ts('confirmed_at'),
  cancelledAt:          ts('cancelled_at'),
  completedAt:          ts('completed_at'),
  reminder24hSentAt:    ts('reminder_24h_sent_at'),
  reminder2hSentAt:     ts('reminder_2h_sent_at'),
  advisorRemindedAt:    ts('advisor_reminded_at'),
  postCheckSentAt:      ts('post_check_sent_at'),
  feedbackRequestedAt:  ts('feedback_requested_at'),
  reofferSentAt:        ts('reoffer_sent_at'),
  createdAt:            ts('created_at').notNull().$defaultFn(() => new Date()),
  updatedAt:            ts('updated_at').notNull().$defaultFn(() => new Date()),
}, (t) => [
  index('idx_property_visits_org_starts').on(t.orgId, t.startsAt),
  index('idx_property_visits_org_profile_starts').on(t.orgId, t.profileId, t.startsAt),
  index('idx_property_visits_lead').on(t.leadId),
  index('idx_property_visits_org_phone_status').on(t.orgId, t.contactPhone, t.status),
  index('idx_property_visits_org_created').on(t.orgId, t.createdAt),
  uniqueIndex('property_visits_google_event_uniq').on(t.googleConnectionId, t.googleEventId).where(sql`google_event_id IS NOT NULL`),
  index('idx_property_visits_google_pending').on(t.profileId, t.updatedAt).where(sql`google_sync_status IN ('pending', 'error')`),
  check('property_visits_status_check', sql`status IN ('scheduled', 'confirmed', 'completed', 'no_show', 'cancelled', 'rescheduled')`),
  check('property_visits_created_by_check', sql`created_by IN ('agent', 'human')`),
  check('property_visits_source_channel_check', sql`source_channel IN ('whatsapp', 'web', 'voice', 'manual')`),
  check('property_visits_feedback_check', sql`feedback IS NULL OR feedback IN ('interested', 'not_interested', 'wants_more')`),
  check('property_visits_outcome_source_check', sql`outcome_source IS NULL OR outcome_source IN ('staff', 'lead')`),
  check('property_visits_ends_after_starts', sql`ends_at > starts_at`),
  check('property_visits_blocked_after_ends', sql`blocked_until >= ends_at`),
  check('property_visits_google_sync_status_check', sql`google_sync_status IN ('none', 'pending', 'synced', 'error', 'detached', 'drift')`),
]);

export const calendarConnections = sqliteTable('calendar_connections', {
  id:                    id(),
  orgId:                 text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  profileId:             text('profile_id').notNull().references(() => profiles.id, { onDelete: 'cascade' }),
  provider:              text('provider').notNull().default('google'), // 'google'
  googleEmail:           text('google_email').notNull(),
  calendarId:            text('calendar_id').notNull().default('primary'),
  scopes:                json<string[]>('scopes').notNull().default([]),
  refreshTokenEnc:       text('refresh_token_enc').notNull(),
  accessTokenEnc:        text('access_token_enc'),
  accessTokenExpiresAt:  ts('access_token_expires_at'),
  status:                text('status').notNull().default('active'), // 'active'|'revoked'|'error'
  lastError:             text('last_error'),
  freebusyEnabled:       bool('freebusy_enabled').notNull().default(true),
  writeEvents:           bool('write_events').notNull().default(true),
  syncToken:             text('sync_token'),
  syncPageToken:         text('sync_page_token'),
  lastSyncedAt:          ts('last_synced_at'),
  lastFullSyncAt:        ts('last_full_sync_at'),
  createdAt:             ts('created_at').notNull().$defaultFn(() => new Date()),
  updatedAt:             ts('updated_at').notNull().$defaultFn(() => new Date()),
}, (t) => [
  uniqueIndex('calendar_connections_org_profile_uidx').on(t.orgId, t.profileId),
  index('idx_calendar_connections_org_status').on(t.orgId, t.status),
  check('calendar_connections_provider_check', sql`provider IN ('google')`),
  check('calendar_connections_status_check', sql`status IN ('active', 'revoked', 'error')`),
]);

export const leadPipelineStages = sqliteTable('lead_pipeline_stages', {
  id:         id(),
  orgId:      text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  pipeline:   text('pipeline').notNull(), // 'demand'|'supply'
  key:        text('key').notNull(),
  label:      text('label').notNull(),
  position:   integer('position').notNull(),
  kind:       text('kind').notNull(), // 'open'|'won'|'lost'
  color:      text('color'),
  isSystem:   bool('is_system').notNull().default(false),
  archived:   bool('archived').notNull().default(false),
  createdAt:  ts('created_at').notNull().$defaultFn(() => new Date()),
  updatedAt:  ts('updated_at').notNull().$defaultFn(() => new Date()),
}, (t) => [
  uniqueIndex('lead_pipeline_stages_org_pipeline_key_uniq').on(t.orgId, t.pipeline, t.key),
  index('idx_lead_pipeline_stages_org_pipeline').on(t.orgId, t.pipeline, t.position),
  check('lead_pipeline_stages_pipeline_check', sql`pipeline IN ('demand', 'supply')`),
  check('lead_pipeline_stages_key_check', sql`(length(key) BETWEEN 2 AND 40 AND key GLOB '[a-z]*' AND key NOT GLOB '*[^a-z0-9_]*')`),
  check('lead_pipeline_stages_label_check', sql`length(label) BETWEEN 1 AND 60`),
  check('lead_pipeline_stages_kind_check', sql`kind IN ('open', 'won', 'lost')`),
  check('lead_pipeline_stages_color_check', sql`color IS NULL OR color GLOB '#[0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F]'`),
]);

export const leadRoutingMembers = sqliteTable('lead_routing_members', {
  id:              id(),
  orgId:           text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  profileId:       text('profile_id').notNull().references(() => profiles.id, { onDelete: 'cascade' }),
  pipeline:        text('pipeline').notNull().default('both'), // 'demand'|'supply'|'both'
  weight:          integer('weight').notNull().default(1),
  active:          bool('active').notNull().default(true),
  maxOpenLeads:    integer('max_open_leads'),
  assignedCount:   integer('assigned_count').notNull().default(0),
  lastAssignedAt:  ts('last_assigned_at'),
  createdAt:       ts('created_at').notNull().$defaultFn(() => new Date()),
  updatedAt:       ts('updated_at').notNull().$defaultFn(() => new Date()),
}, (t) => [
  uniqueIndex('lead_routing_members_org_profile_uniq').on(t.orgId, t.profileId),
  check('lead_routing_members_pipeline_check', sql`pipeline IN ('demand', 'supply', 'both')`),
  check('lead_routing_members_weight_check', sql`weight BETWEEN 1 AND 100`),
  check('lead_routing_members_max_open_leads_check', sql`max_open_leads IS NULL OR max_open_leads > 0`),
]);

export const leadAssignments = sqliteTable('lead_assignments', {
  id:                  id(),
  orgId:               text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  leadId:              text('lead_id').notNull().references(() => crmLeads.id, { onDelete: 'cascade' }),
  profileId:           text('profile_id').references(() => profiles.id, { onDelete: 'set null' }),
  previousProfileId:   text('previous_profile_id').references(() => profiles.id, { onDelete: 'set null' }),
  method:              text('method'), // 'round_robin'|'weighted'|'manual'|'visit'|'reassign'
  assignedByProfileId: text('assigned_by_profile_id').references(() => profiles.id, { onDelete: 'set null' }),
  createdAt:           ts('created_at').notNull().$defaultFn(() => new Date()),
}, (t) => [
  index('idx_lead_assignments_org_created').on(t.orgId, t.createdAt),
  index('idx_lead_assignments_lead').on(t.leadId),
  check('lead_assignments_method_check', sql`method IN ('round_robin', 'weighted', 'manual', 'visit', 'reassign')`),
]);

export const leadFollowups = sqliteTable('lead_followups', {
  id:                id(),
  orgId:             text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  leadId:            text('lead_id').notNull().references(() => crmLeads.id, { onDelete: 'cascade' }),
  sessionId:         text('session_id').references(() => agentSessions.id, { onDelete: 'set null' }),
  sequenceAnchorAt:  ts('sequence_anchor_at').notNull(),
  step:              integer('step').notNull(),
  kind:              text('kind').notNull(), // 'text'|'template'
  templateName:      text('template_name'),
  scheduledFor:      ts('scheduled_for').notNull(),
  status:            text('status').notNull().default('scheduled'),
  // 'scheduled'|'sending'|'sent'|'skipped'|'cancelled'|'failed'
  stopReason:        text('stop_reason'),
  sentAt:            ts('sent_at'),
  createdAt:         ts('created_at').notNull().$defaultFn(() => new Date()),
  updatedAt:         ts('updated_at').notNull().$defaultFn(() => new Date()),
}, (t) => [
  uniqueIndex('lead_followups_lead_anchor_step_uniq').on(t.leadId, t.sequenceAnchorAt, t.step),
  index('idx_lead_followups_org_status_scheduled').on(t.orgId, t.status, t.scheduledFor),
  index('idx_lead_followups_lead_status').on(t.leadId, t.status),
  check('lead_followups_step_check', sql`step BETWEEN 1 AND 10`),
  check('lead_followups_kind_check', sql`kind IN ('text', 'template')`),
  check('lead_followups_status_check', sql`status IN ('scheduled', 'sending', 'sent', 'skipped', 'cancelled', 'failed')`),
]);

export const leadListingAlerts = sqliteTable('lead_listing_alerts', {
  id:         id(),
  orgId:      text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  leadId:     text('lead_id').notNull().references(() => crmLeads.id, { onDelete: 'cascade' }),
  listingId:  text('listing_id').notNull().references(() => listings.id, { onDelete: 'cascade' }),
  status:     text('status'), // 'sent'|'skipped'|'failed'
  reason:     text('reason'),
  createdAt:  ts('created_at').notNull().$defaultFn(() => new Date()),
}, (t) => [
  uniqueIndex('lead_listing_alerts_lead_listing_uniq').on(t.leadId, t.listingId),
  check('lead_listing_alerts_status_check', sql`status IN ('sent', 'skipped', 'failed')`),
]);

export const qaExports = sqliteTable('qa_exports', {
  id:                   id(),
  orgId:                text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  weekStart:            dateStr('week_start').notNull(),
  periodStart:          ts('period_start'),
  periodEnd:            ts('period_end'),
  rowCount:             integer('row_count'),
  handoffCount:         integer('handoff_count'),
  complaintCount:       integer('complaint_count'),
  takeoverCount:        integer('takeover_count'),
  csv:                  text('csv').notNull(),
  emailedAt:            ts('emailed_at'),
  emailRecipientCount:  integer('email_recipient_count').notNull().default(0),
  createdAt:            ts('created_at').notNull().$defaultFn(() => new Date()),
}, (t) => [
  uniqueIndex('qa_exports_org_week_uniq').on(t.orgId, t.weekStart),
]);

export const agentWebSessions = sqliteTable('agent_web_sessions', {
  id:                id(),
  orgId:             text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  tokenHash:         text('token_hash').notNull().unique(),
  agentSessionId:    text('agent_session_id').references(() => agentSessions.id, { onDelete: 'set null' }),
  ipHash:            text('ip_hash'),
  origin:            text('origin'),
  pageUrl:           text('page_url'),
  currentListingId:  text('current_listing_id').references(() => listings.id, { onDelete: 'set null' }),
  phoneE164:         text('phone_e164'),
  phoneCapturedAt:   ts('phone_captured_at'),
  messageCount:      integer('message_count').notNull().default(0),
  lastMessageAt:     ts('last_message_at'),
  processingUntil:   ts('processing_until'),
  expiresAt:         ts('expires_at').notNull(),
  createdAt:         ts('created_at').notNull().$defaultFn(() => new Date()),
}, (t) => [
  index('idx_agent_web_sessions_org').on(t.orgId, t.createdAt),
  check('agent_web_sessions_page_url_check', sql`page_url IS NULL OR length(page_url) <= 500`),
]);

export const agentWebHandoffCodes = sqliteTable('agent_web_handoff_codes', {
  id:                 id(),
  orgId:              text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  // Phase 8: nullable — voice codes (source='voice') have no web session.
  webSessionId:       text('web_session_id').references(() => agentWebSessions.id, { onDelete: 'cascade' }),
  code:               text('code').notNull(),
  kind:               text('kind').notNull(), // 'visit'|'continue'
  leadId:             text('lead_id').references(() => crmLeads.id, { onDelete: 'set null' }),
  listingId:          text('listing_id').references(() => listings.id, { onDelete: 'set null' }),
  profileId:          text('profile_id').references(() => profiles.id, { onDelete: 'set null' }),
  startsAt:           ts('starts_at'),
  visitMinutes:       integer('visit_minutes'),
  status:             text('status').notNull().default('pending'),
  // 'pending'|'redeemed'|'failed'|'expired'|'superseded'
  redeemedPhone:      text('redeemed_phone'),
  redeemedSessionId:  text('redeemed_session_id').references(() => agentSessions.id, { onDelete: 'set null' }),
  visitId:            text('visit_id').references(() => propertyVisits.id, { onDelete: 'set null' }),
  result:             text('result'),
  expiresAt:          ts('expires_at').notNull(),
  redeemedAt:         ts('redeemed_at'),
  createdAt:          ts('created_at').notNull().$defaultFn(() => new Date()),
  // Phase 8: 'web'|'voice'. Voice codes ('VOZ-XXXXXX') carry a call_id and
  // redeem only from target_phone — see src/lib/widget/handoff-codes.ts.
  source:             text('source').notNull().default('web'),
  callId:             text('call_id').references(() => agentCalls.id, { onDelete: 'set null' }),
  targetPhone:        text('target_phone'),
}, (t) => [
  uniqueIndex('uq_web_handoff_code').on(t.orgId, t.code),
  index('idx_web_handoff_session').on(t.webSessionId, t.status),
  index('idx_handoff_voice_phone').on(t.orgId, t.targetPhone, t.status).where(sql`source = 'voice'`),
  check('agent_web_handoff_codes_kind_check', sql`kind IN ('visit', 'continue')`),
  check('agent_web_handoff_codes_status_check', sql`status IN ('pending', 'redeemed', 'failed', 'expired', 'superseded')`),
  check('chk_web_handoff_visit', sql`kind <> 'visit' OR (starts_at IS NOT NULL AND profile_id IS NOT NULL AND visit_minutes IS NOT NULL)`),
  check('agent_web_handoff_codes_source_check', sql`source IN ('web', 'voice')`),
  check('chk_handoff_source', sql`(source = 'web' AND web_session_id IS NOT NULL) OR (source = 'voice' AND call_id IS NOT NULL AND target_phone IS NOT NULL)`),
]);

export const agentWebUsageDaily = sqliteTable('agent_web_usage_daily', {
  orgId:    text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  day:      dateStr('day').notNull(),
  sessions: integer('sessions').notNull().default(0),
  messages: integer('messages').notNull().default(0),
}, (t) => [
  primaryKey({ columns: [t.orgId, t.day] }),
]);

export const agentCalls = sqliteTable('agent_calls', {
  id:               id(),
  orgId:            text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  sessionId:        text('session_id').references(() => agentSessions.id, { onDelete: 'set null' }),
  leadId:           text('lead_id').references(() => crmLeads.id, { onDelete: 'set null' }),
  visitId:          text('visit_id').references(() => propertyVisits.id, { onDelete: 'set null' }),
  direction:        text('direction').notNull(),   // 'inbound'|'outbound'
  purpose:          text('purpose').notNull(),      // 'inbound'|'speed_to_lead'|'visit_confirmation'|'reactivation'
  status:           text('status').notNull().default('queued'),
  // 'queued'|'dialing'|'in_progress'|'ended'|'failed'|'skipped'|'blocked'
  blockReason:      text('block_reason'),
  dedupeKey:        text('dedupe_key'),
  vapiCallId:       text('vapi_call_id').unique(),
  phoneNumberId:    text('phone_number_id'),
  customerPhone:    text('customer_phone'),
  startedAt:        ts('started_at'),
  endedAt:          ts('ended_at'),
  durationSeconds:  integer('duration_seconds'),
  endedReason:      text('ended_reason'),
  outcome:          text('outcome'), // 'answered'|'no_answer'|'busy'|'voicemail'|'failed'|'abandoned'
  transcript:       text('transcript'),
  recordingUrl:     text('recording_url'),
  summary:          text('summary'),
  costUsd:          money('cost_usd'),
  costBreakdown:    json<unknown>('cost_breakdown'),
  createdAt:        ts('created_at').notNull().$defaultFn(() => new Date()),
  updatedAt:        ts('updated_at').notNull().$defaultFn(() => new Date()),
}, (t) => [
  uniqueIndex('agent_calls_dedupe').on(t.orgId, t.dedupeKey).where(sql`dedupe_key IS NOT NULL`),
  index('idx_agent_calls_org_created').on(t.orgId, t.createdAt),
  index('idx_agent_calls_org_status').on(t.orgId, t.status),
  index('idx_agent_calls_lead').on(t.leadId),
  check('agent_calls_direction_check', sql`direction IN ('inbound', 'outbound')`),
  check('agent_calls_purpose_check', sql`purpose IN ('inbound', 'speed_to_lead', 'visit_confirmation', 'reactivation')`),
  check('agent_calls_status_check', sql`status IN ('queued', 'dialing', 'in_progress', 'ended', 'failed', 'skipped', 'blocked')`),
  check('agent_calls_duration_seconds_check', sql`duration_seconds IS NULL OR duration_seconds >= 0`),
  check('agent_calls_outcome_check', sql`outcome IS NULL OR outcome IN ('answered', 'no_answer', 'busy', 'voicemail', 'failed', 'abandoned')`),
]);

export const voiceDoNotCall = sqliteTable('voice_do_not_call', {
  orgId:            text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  phoneE164:        text('phone_e164').notNull(),
  reason:           text('reason'),
  source:           text('source').notNull(), // 'staff'|'caller_request'
  addedByProfileId: text('added_by_profile_id').references(() => profiles.id, { onDelete: 'set null' }),
  createdAt:        ts('created_at').notNull().$defaultFn(() => new Date()),
}, (t) => [
  primaryKey({ columns: [t.orgId, t.phoneE164] }),
  check('voice_do_not_call_phone_e164_check', sql`(length(phone_e164) BETWEEN 8 AND 16 AND phone_e164 GLOB '+[1-9]*' AND substr(phone_e164, 2) NOT GLOB '*[^0-9]*')`),
  check('voice_do_not_call_reason_check', sql`reason IS NULL OR length(reason) <= 200`),
  check('voice_do_not_call_source_check', sql`source IN ('staff', 'caller_request')`),
]);

export const agentSessionListings = sqliteTable('agent_session_listings', {
  sessionId:  text('session_id').notNull().references(() => agentSessions.id, { onDelete: 'cascade' }),
  orgId:      text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  listingId:  text('listing_id').notNull().references(() => listings.id, { onDelete: 'cascade' }),
  source:     text('source').notNull(), // 'search'|'attribution'|'page'
  createdAt:  ts('created_at').notNull().$defaultFn(() => new Date()),
}, (t) => [
  primaryKey({ columns: [t.sessionId, t.listingId] }),
  check('agent_session_listings_source_check', sql`source IN ('search', 'attribution', 'page')`),
]);

export const leadConversions = sqliteTable('lead_conversions', {
  id:         id(),
  orgId:      text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  leadId:     text('lead_id').notNull().references(() => crmLeads.id, { onDelete: 'cascade' }),
  tenantId:   text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  contractId: text('contract_id').notNull().references(() => contracts.id, { onDelete: 'cascade' }),
  createdAt:  ts('created_at').notNull().$defaultFn(() => new Date()),
}, (t) => [
  uniqueIndex('lead_conversions_lead_uniq').on(t.leadId),
  index('idx_lead_conversions_org').on(t.orgId),
]);

export const rentalApplications = sqliteTable('rental_applications', {
  id:               id(),
  orgId:            text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  listingId:        text('listing_id').references(() => listings.id, { onDelete: 'set null' }),
  fullName:         text('full_name').notNull(),
  email:            text('email').notNull(),
  phone:            text('phone').notNull(),
  monthlyIncome:    money('monthly_income').notNull(),
  monthlyRent:      money('monthly_rent'),
  employmentType:   text('employment_type').notNull(), // 'employee'|'self_employed'|'retired'|'student'|'other'
  employmentMonths: integer('employment_months').notNull(),
  householdSize:    integer('household_size').notNull(),
  hasGuarantor:     bool('has_guarantor').notNull().default(false),
  moveInDate:       dateStr('move_in_date'),
  message:          text('message'),
  documents:        json<{ path: string; mime: string; name: string }[]>('documents').notNull().$defaultFn(() => []),
  score:            integer('score').notNull(),
  status:           text('status').notNull().default('new'), // 'new'|'reviewing'|'approved'|'rejected'
  createdAt:        ts('created_at').notNull().$defaultFn(() => new Date()),
  updatedAt:        ts('updated_at').notNull().$defaultFn(() => new Date()),
}, (t) => [
  index('idx_rental_applications_org_created').on(t.orgId, t.createdAt),
  check('rental_applications_employment_type_check', sql`employment_type IN ('employee', 'self_employed', 'retired', 'student', 'other')`),
  check('rental_applications_status_check', sql`status IN ('new', 'reviewing', 'approved', 'rejected')`),
  check('rental_applications_score_check', sql`score BETWEEN 0 AND 100`),
]);
