import { sqliteTable, text, integer, uniqueIndex, index, check } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { id, json, ts, money, dateStr, bool, createdAt, updatedAt } from './columns';
import type { HandoverItem } from '@/lib/contracts/handover-types';
import { contracts, organizations, profiles, properties, tenants, units, whatsappMessages } from './core';

export const incidents = sqliteTable('incidents', {
  id:                 id(),
  orgId:              text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  unitId:             text('unit_id').references(() => units.id, { onDelete: 'set null' }),
  propertyId:         text('property_id').references(() => properties.id, { onDelete: 'set null' }),
  createdBy:          text('created_by').references(() => profiles.id, { onDelete: 'cascade' }),  // nullable after migration 054
  tenantId:           text('tenant_id').references(() => tenants.id, { onDelete: 'set null' }),
  assignedTo:         text('assigned_to').references(() => profiles.id, { onDelete: 'set null' }),
  category:           text('category').notNull(),
  title:              text('title').notNull(),
  description:        text('description').notNull(),
  priority:           text('priority').notNull().default('medium'),  // 'low'|'medium'|'high'|'urgent'
  status:             text('status').notNull().default('pending'),   // 'pending'|'in_progress'|'solved'
  photoPath:          text('photo_path'),
  resolvedAt:         ts('resolved_at'),
  cost:               money('cost'),
  airtableExternalId: text('airtable_external_id'),
  airtableSyncedAt:   ts('airtable_synced_at'),
  createdAt:          ts('created_at').notNull().$defaultFn(() => new Date()),
  updatedAt:          ts('updated_at').notNull().$defaultFn(() => new Date()),
}, (t) => [
  index('idx_incidents_org_id').on(t.orgId),
  index('idx_incidents_org_status').on(t.orgId, t.status),
  index('idx_incidents_created_by').on(t.createdBy),
  index('idx_incidents_assigned_to').on(t.assignedTo),
  uniqueIndex('incidents_org_airtable_uniq').on(t.orgId, t.airtableExternalId),
  check('incidents_category_check', sql`category IN ('plumbing','electrical','appliance','structural','cleaning','other','material_damage','malfunction')`),
  check('incidents_priority_check', sql`priority IN ('low','medium','high','urgent')`),
  check('incidents_status_check', sql`status IN ('pending','in_progress','solved')`),
]);

export const incidentSchedules = sqliteTable('incident_schedules', {
  id:          id(),
  orgId:       text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  incidentId:  text('incident_id').notNull().references(() => incidents.id, { onDelete: 'cascade' }),
  estimatedOn: dateStr('estimated_on'),
  createdAt:   ts('created_at').notNull().$defaultFn(() => new Date()),
  updatedAt:   ts('updated_at').notNull().$defaultFn(() => new Date()),
}, (t) => [
  uniqueIndex('incident_schedules_incident_uniq').on(t.incidentId),
  index('idx_incident_schedules_org_estimated').on(t.orgId, t.estimatedOn),
]);

export const incidentComments = sqliteTable('incident_comments', {
  id:         id(),
  orgId:      text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  incidentId: text('incident_id').notNull().references(() => incidents.id, { onDelete: 'cascade' }),
  authorId:   text('author_id').notNull().references(() => profiles.id, { onDelete: 'cascade' }),
  body:       text('body').notNull(),
  createdAt:  ts('created_at').notNull().$defaultFn(() => new Date()),
  updatedAt:  ts('updated_at').notNull().$defaultFn(() => new Date()),
}, (t) => [
  index('idx_incident_comments_org_id').on(t.orgId),
  index('idx_incident_comments_incident_time').on(t.incidentId, t.createdAt),
  check('incident_comments_body_check', sql`length(body) > 0`),
]);

export const internalNotes = sqliteTable('internal_notes', {
  id:        id(),
  orgId:     text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  tenantId:  text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  content:   text('content').notNull(),
  createdBy: text('created_by').notNull().references(() => profiles.id, { onDelete: 'restrict' }),
  createdAt: ts('created_at').notNull().$defaultFn(() => new Date()),
}, (t) => [
  index('idx_internal_notes_tenant').on(t.tenantId, t.createdAt),
  index('idx_internal_notes_org').on(t.orgId, t.createdAt),
]);

export const contractTemplates = sqliteTable('contract_templates', {
  id:           id(),
  orgId:        text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  name:         text('name').notNull(),
  bodyMarkdown: text('body_markdown').notNull(),
  variables:    json<unknown>('variables').notNull().default([]),
  createdAt:    ts('created_at').notNull().$defaultFn(() => new Date()),
  updatedAt:    ts('updated_at').notNull().$defaultFn(() => new Date()),
}, (t) => [
  index('idx_contract_templates_org').on(t.orgId),
  uniqueIndex('contract_templates_org_name_uniq').on(t.orgId, t.name),
]);

export const orgSignatures = sqliteTable('org_signatures', {
  orgId:          text('org_id').primaryKey().references(() => organizations.id, { onDelete: 'cascade' }),
  signerName:     text('signer_name').notNull(),
  signerDocument: text('signer_document'),
  imageDataUrl:   text('image_data_url').notNull(),
  updatedAt:      ts('updated_at').notNull().$defaultFn(() => new Date()),
});

export const pricingTables = sqliteTable('pricing_tables', {
  id:           id(),
  orgId:        text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  name:         text('name').notNull(),
  propertyType: text('property_type').notNull(),
  marketZone:   text('market_zone').notNull(),
  tiers:        json<unknown>('tiers').notNull().default([]),
  createdAt:    ts('created_at').notNull().$defaultFn(() => new Date()),
  updatedAt:    ts('updated_at').notNull().$defaultFn(() => new Date()),
}, (t) => [
  index('idx_pricing_tables_org').on(t.orgId),
  index('idx_pricing_tables_org_type').on(t.orgId, t.propertyType, t.marketZone),
]);

export const communityPosts = sqliteTable('community_posts', {
  id:        id(),
  orgId:     text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  authorId:  text('author_id').notNull().references(() => profiles.id, { onDelete: 'cascade' }),
  title:     text('title').notNull(),
  body:      text('body').notNull(),
  category:  text('category').notNull().default('general'),
  pinned:    bool('pinned').notNull().default(false),
  createdAt: ts('created_at').notNull().$defaultFn(() => new Date()),
  updatedAt: ts('updated_at').notNull().$defaultFn(() => new Date()),
}, (t) => [
  index('idx_community_posts_org').on(t.orgId),
  index('idx_community_posts_org_pinned').on(t.orgId, t.pinned, t.createdAt),
  index('idx_community_posts_author').on(t.authorId),
  check('community_posts_category_check', sql`category IN ('general','question','marketplace','event')`),
]);

export const communityComments = sqliteTable('community_comments', {
  id:        id(),
  orgId:     text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  postId:    text('post_id').notNull().references(() => communityPosts.id, { onDelete: 'cascade' }),
  authorId:  text('author_id').notNull().references(() => profiles.id, { onDelete: 'cascade' }),
  body:      text('body').notNull(),
  createdAt: ts('created_at').notNull().$defaultFn(() => new Date()),
  updatedAt: ts('updated_at').notNull().$defaultFn(() => new Date()),
}, (t) => [
  index('idx_community_comments_org').on(t.orgId),
  index('idx_community_comments_post_ts').on(t.postId, t.createdAt),
]);

export const announcements = sqliteTable('announcements', {
  id:          id(),
  orgId:       text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  createdBy:   text('created_by').notNull().references(() => profiles.id, { onDelete: 'cascade' }),
  title:       text('title').notNull(),
  body:        text('body').notNull(),
  audience:    text('audience').notNull().default('all'),  // 'all'|'property'|'unit'
  propertyId:  text('property_id').references(() => properties.id, { onDelete: 'set null' }),
  unitId:      text('unit_id').references(() => units.id, { onDelete: 'set null' }),
  publishedAt: ts('published_at'),
  expiresAt:   ts('expires_at'),
  createdAt:   ts('created_at').notNull().$defaultFn(() => new Date()),
  updatedAt:   ts('updated_at').notNull().$defaultFn(() => new Date()),
}, (t) => [
  index('idx_announcements_org').on(t.orgId),
  index('idx_announcements_org_pub').on(t.orgId, t.publishedAt),
  index('idx_announcements_property').on(t.propertyId),
  index('idx_announcements_unit').on(t.unitId),
  check('announcements_audience_check', sql`audience IN ('all','property','unit')`),
]);

export const cleaningTasks = sqliteTable('cleaning_tasks', {
  id:            id(),
  orgId:         text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  unitId:        text('unit_id').references(() => units.id, { onDelete: 'set null' }),
  assignedTo:    text('assigned_to').references(() => profiles.id, { onDelete: 'set null' }),
  title:         text('title').notNull(),
  scheduledDate: dateStr('scheduled_date').notNull(),
  status:        text('status').notNull().default('pending'),  // 'pending'|'in_progress'|'done'
  notes:         text('notes'),
  completedAt:   ts('completed_at'),
  createdAt:     ts('created_at').notNull().$defaultFn(() => new Date()),
  updatedAt:     ts('updated_at').notNull().$defaultFn(() => new Date()),
}, (t) => [
  index('idx_cleaning_tasks_org').on(t.orgId),
  index('idx_cleaning_tasks_org_date').on(t.orgId, t.scheduledDate),
  index('idx_cleaning_tasks_unit').on(t.unitId),
  index('idx_cleaning_tasks_assignee').on(t.assignedTo),
  check('cleaning_tasks_status_check', sql`status IN ('pending','in_progress','done')`),
]);

export const signatureRequests = sqliteTable('signature_requests', {
  id:                 id(),
  orgId:              text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  contractId:         text('contract_id').notNull().references(() => contracts.id, { onDelete: 'cascade' }),
  signerProfileId:    text('signer_profile_id').references(() => profiles.id, { onDelete: 'set null' }),
  signerEmail:        text('signer_email').notNull(),
  token:              text('token').notNull().unique().$defaultFn(() => crypto.randomUUID()),
  status:             text('status').notNull().default('sent'),  // 'sent'|'viewed'|'signed'|'declined'|'expired'
  sentAt:             ts('sent_at').notNull().$defaultFn(() => new Date()),
  viewedAt:           ts('viewed_at'),
  signedAt:           ts('signed_at'),
  expiresAt:          ts('expires_at').notNull(),
  signatureImagePath: text('signature_image_path'),
  signedIp:           text('signed_ip'),
  signedUserAgent:    text('signed_user_agent'),
  documentSha256:     text('document_sha256'),
  signatureSha256:    text('signature_sha256'),
  handoverActId:      text('handover_act_id').references(() => handoverActs.id, { onDelete: 'cascade' }),
  createdAt:          ts('created_at').notNull().$defaultFn(() => new Date()),
  updatedAt:          ts('updated_at').notNull().$defaultFn(() => new Date()),
}, (t) => [
  index('idx_signature_requests_org').on(t.orgId),
  index('idx_signature_requests_contract').on(t.contractId),
  check('signature_requests_status_check', sql`status IN ('sent','viewed','signed','declined','expired')`),
]);

export const unitInventoryItems = sqliteTable('unit_inventory_items', {
  id:        id(),
  orgId:     text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  unitId:    text('unit_id').notNull().references(() => units.id, { onDelete: 'cascade' }),
  name:      text('name').notNull(),
  quantity:  integer('quantity').notNull().default(1),
  condition: text('condition').notNull().default('good'),
  notes:     text('notes'),
  createdAt: ts('created_at').notNull().$defaultFn(() => new Date()),
  updatedAt: ts('updated_at').notNull().$defaultFn(() => new Date()),
}, (t) => [
  index('idx_unit_inventory_items_unit').on(t.orgId, t.unitId),
  check('unit_inventory_items_condition_check', sql`condition IN ('new','good','fair','poor','broken')`),
]);

export const handoverActs = sqliteTable('handover_acts', {
  id:           id(),
  orgId:        text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  contractId:   text('contract_id').notNull().references(() => contracts.id, { onDelete: 'cascade' }),
  kind:         text('kind').notNull(),
  items:        json<HandoverItem[]>('items').notNull(),
  notes:        text('notes'),
  documentPath: text('document_path'),
  status:       text('status').notNull().default('draft'),
  signedAt:     ts('signed_at'),
  createdAt:    ts('created_at').notNull().$defaultFn(() => new Date()),
  updatedAt:    ts('updated_at').notNull().$defaultFn(() => new Date()),
}, (t) => [
  index('idx_handover_acts_contract').on(t.orgId, t.contractId),
  check('handover_acts_kind_check', sql`kind IN ('check_in','check_out')`),
  check('handover_acts_status_check', sql`status IN ('draft','pending_signature','signed')`),
]);

export const documents = sqliteTable('documents', {
  id:              id(),
  orgId:           text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  tenantId:        text('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  contractId:      text('contract_id').references(() => contracts.id, { onDelete: 'cascade' }),
  propertyId:      text('property_id').references(() => properties.id, { onDelete: 'cascade' }),
  name:            text('name').notNull(),
  category:        text('category').notNull(),
  storagePath:     text('storage_path').notNull(),
  mimeType:        text('mime_type').notNull(),
  sizeBytes:       integer('size_bytes').notNull(),
  expiresOn:       dateStr('expires_on'),
  visibleToTenant: bool('visible_to_tenant').notNull().default(false),
  uploadedBy:      text('uploaded_by'),
  createdAt:       ts('created_at').notNull().$defaultFn(() => new Date()),
}, (t) => [
  index('idx_documents_org_created').on(t.orgId, t.createdAt),
  index('idx_documents_tenant').on(t.tenantId),
  index('idx_documents_contract').on(t.contractId),
  index('idx_documents_property').on(t.propertyId),
  index('idx_documents_org_expires').on(t.orgId, t.expiresOn),
  check('documents_one_entity_check', sql`(tenant_id IS NOT NULL) + (contract_id IS NOT NULL) + (property_id IS NOT NULL) = 1`),
  check('documents_category_check', sql`category IN ('identity','contract','insurance','certificate','invoice','other')`),
]);

export const reminders = sqliteTable('reminders', {
  id:             id(),
  orgId:          text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  type:           text('type').notNull(),        // 'lease_renewal'|'payment_due'|'custom'
  targetType:     text('target_type').notNull(), // 'contract'|'charge'|'tenant'
  targetId:       text('target_id').notNull(),
  channel:        text('channel').notNull().default('both'),  // 'email'|'in_app'|'both'
  scheduledFor:   dateStr('scheduled_for').notNull(),
  sentAt:         ts('sent_at'),
  status:         text('status').notNull().default('scheduled'),  // 'scheduled'|'sent'|'failed'|'skipped'
  messagePreview: text('message_preview'),
  error:          text('error'),
  createdAt:      ts('created_at').notNull().$defaultFn(() => new Date()),
  updatedAt:      ts('updated_at').notNull().$defaultFn(() => new Date()),
}, (t) => [
  index('idx_reminders_org').on(t.orgId),
  index('idx_reminders_org_date_status').on(t.orgId, t.scheduledFor, t.status),
  index('idx_reminders_target').on(t.targetType, t.targetId),
  check('reminders_type_check', sql`type IN ('lease_renewal','payment_due','custom')`),
  check('reminders_target_type_check', sql`target_type IN ('contract','charge','tenant')`),
  check('reminders_channel_check', sql`channel IN ('email','in_app','both')`),
  check('reminders_status_check', sql`status IN ('scheduled','sent','failed','skipped')`),
]);

export const notificationInbox = sqliteTable('notification_inbox', {
  id:          id(),
  orgId:       text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  profileId:   text('profile_id').notNull().references(() => profiles.id, { onDelete: 'cascade' }),
  type:        text('type').notNull(),
  title:       text('title').notNull(),
  body:        text('body').notNull(),
  relatedType: text('related_type'),
  relatedId:   text('related_id'),
  readAt:      ts('read_at'),
  createdAt:   ts('created_at').notNull().$defaultFn(() => new Date()),
  updatedAt:   ts('updated_at').notNull().$defaultFn(() => new Date()),
}, (t) => [
  index('idx_notification_inbox_org').on(t.orgId),
  index('idx_notification_inbox_profile_read').on(t.profileId, t.readAt),
  index('idx_notification_inbox_profile_ts').on(t.profileId, t.createdAt),
]);

export const visitorLogs = sqliteTable('visitor_logs', {
  id:           id(),
  orgId:        text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  propertyId:   text('property_id').references(() => properties.id, { onDelete: 'set null' }),
  unitId:       text('unit_id').references(() => units.id, { onDelete: 'set null' }),
  visitorName:  text('visitor_name').notNull(),
  hostTenantId: text('host_tenant_id').references(() => tenants.id, { onDelete: 'set null' }),
  visitDate:    dateStr('visit_date').notNull(),
  entryTime:    ts('entry_time'),
  exitTime:     ts('exit_time'),
  purpose:      text('purpose'),
  createdBy:    text('created_by').notNull().references(() => profiles.id, { onDelete: 'cascade' }),
  notes:        text('notes'),
  createdAt:    ts('created_at').notNull().$defaultFn(() => new Date()),
  updatedAt:    ts('updated_at').notNull().$defaultFn(() => new Date()),
}, (t) => [
  index('idx_visitor_logs_org').on(t.orgId),
  index('idx_visitor_logs_org_date').on(t.orgId, t.visitDate),
  index('idx_visitor_logs_unit').on(t.unitId),
  index('idx_visitor_logs_host').on(t.hostTenantId),
]);

export const aiChatMessages = sqliteTable('ai_chat_messages', {
  id:        id(),
  orgId:     text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  profileId: text('profile_id').notNull().references(() => profiles.id, { onDelete: 'cascade' }),
  sessionId: text('session_id').notNull(),
  role:      text('role').notNull(),  // 'user' | 'assistant'
  content:   text('content').notNull(),
  createdAt: ts('created_at').notNull().$defaultFn(() => new Date()),
  // no updated_at — immutable rows
}, (t) => [
  index('idx_ai_chat_org').on(t.orgId),
  index('idx_ai_chat_session_ts').on(t.profileId, t.sessionId, t.createdAt),
  check('ai_chat_messages_role_check', sql`role IN ('user','assistant')`),
]);

export const airtableSnapshots = sqliteTable('airtable_snapshots', {
  id:         id(),
  orgId:      text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  tableName:  text('table_name').notNull(),
  externalId: text('external_id').notNull(),
  data:       json<unknown>('data').notNull(),
  syncedAt:   ts('synced_at').notNull().$defaultFn(() => new Date()),
}, (t) => [
  index('idx_airtable_snapshots_org_table').on(t.orgId, t.tableName),
  index('idx_airtable_snapshots_synced_at').on(t.orgId, t.syncedAt),
  uniqueIndex('airtable_snapshots_org_table_external_uq').on(t.orgId, t.tableName, t.externalId),
]);

export const csvImports = sqliteTable('csv_imports', {
  id:               id(),
  orgId:            text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  importType:       text('import_type').notNull(),
  originalFilename: text('original_filename').notNull(),
  period:           text('period').notNull(),
  status:           text('status').notNull(),  // 'dry_run'|'committed'|'failed'
  rowCount:         integer('row_count').notNull().default(0),
  failedCount:      integer('failed_count').notNull().default(0),
  errorSummary:     json<unknown>('error_summary').notNull().default([]),
  committedAt:      ts('committed_at'),
  createdBy:        text('created_by').notNull().references(() => profiles.id, { onDelete: 'restrict' }),
  createdAt:        ts('created_at').notNull().$defaultFn(() => new Date()),
}, (t) => [
  index('idx_csv_imports_org_created').on(t.orgId, t.createdAt),
  index('idx_csv_imports_org_status').on(t.orgId, t.status),
  check('csv_imports_import_type_check', sql`import_type IN ('monthly_billed','monthly_collected','monthly_summary','room_performance')`),
  check('csv_imports_status_check', sql`status IN ('dry_run','committed','failed')`),
]);

export const importRows = sqliteTable('import_rows', {
  id:             id(),
  importId:       text('import_id').notNull().references(() => csvImports.id, { onDelete: 'cascade' }),
  rowNumber:      integer('row_number').notNull(),
  rawData:        json<unknown>('raw_data').notNull(),
  normalizedData: json<unknown>('normalized_data'),
  status:         text('status').notNull(),  // 'ok'|'warning'|'error'
  errorDetail:    text('error_detail'),
  createdAt:      ts('created_at').notNull().$defaultFn(() => new Date()),
}, (t) => [
  index('idx_import_rows_import_id').on(t.importId, t.rowNumber),
  index('idx_import_rows_status').on(t.importId, t.status),
  check('import_rows_status_check', sql`status IN ('ok','warning','error')`),
]);

export const accountMappings = sqliteTable('account_mappings', {
  id:               id(),
  orgId:            text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  externalAccount:  text('external_account').notNull(),
  internalCategory: text('internal_category'),
  isIncome:         bool('is_income').notNull().default(false),
  affectsNetProfit: bool('affects_net_profit').notNull().default(true),
  createdBy:        text('created_by').references(() => profiles.id, { onDelete: 'set null' }),
}, (t) => [
  index('idx_account_mappings_org').on(t.orgId),
  uniqueIndex('account_mappings_org_account_uq').on(t.orgId, t.externalAccount),
]);

export const propertyMappings = sqliteTable('property_mappings', {
  id:                 id(),
  orgId:              text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  externalName:       text('external_name').notNull(),
  internalPropertyId: text('internal_property_id').references(() => properties.id, { onDelete: 'set null' }),
  lastMatchedAt:      ts('last_matched_at'),
  createdBy:          text('created_by').references(() => profiles.id, { onDelete: 'set null' }),
}, (t) => [
  index('idx_property_mappings_org').on(t.orgId),
  uniqueIndex('property_mappings_org_name_uq').on(t.orgId, t.externalName),
]);

export const phantomRooms = sqliteTable('phantom_rooms', {
  id:           id(),
  orgId:        text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  rawRoomLabel: text('raw_room_label').notNull(),
  matchedUnitId: text('matched_unit_id').references(() => units.id, { onDelete: 'set null' }),
  resolution:   text('resolution').notNull().default('pending'),  // 'pending'|'mapped'|'ignored'
  resolvedBy:   text('resolved_by').references(() => profiles.id, { onDelete: 'set null' }),
  resolvedAt:   ts('resolved_at'),
  createdAt:    ts('created_at').notNull().$defaultFn(() => new Date()),
}, (t) => [
  index('idx_phantom_rooms_org_resolution').on(t.orgId, t.resolution),
  uniqueIndex('phantom_rooms_org_label_uq').on(t.orgId, t.rawRoomLabel),
  check('phantom_rooms_resolution_check', sql`resolution IN ('pending','mapped','ignored')`),
]);

export const unitImages = sqliteTable('unit_images', {
  id:          id(),
  unitId:      text('unit_id').notNull().references(() => units.id, { onDelete: 'cascade' }),
  orgId:       text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
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
  index('idx_unit_images_unit').on(t.unitId, t.sortOrder),
  index('idx_unit_images_org').on(t.orgId),
  uniqueIndex('unit_images_cover_idx').on(t.unitId).where(sql`is_cover = 1`),
]);

export const tenantInvitations = sqliteTable('tenant_invitations', {
  id:         id(),
  orgId:      text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  tenantId:   text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  email:      text('email').notNull(),
  tokenHash:  text('token_hash').notNull(),
  invitedBy:  text('invited_by').references(() => profiles.id, { onDelete: 'set null' }),
  status:     text('status').notNull().default('pending'),  // 'pending'|'accepted'|'expired'|'revoked'
  expiresAt:  ts('expires_at').notNull(),
  acceptedAt: ts('accepted_at'),
  createdAt:  ts('created_at').notNull().$defaultFn(() => new Date()),
}, (t) => [
  uniqueIndex('tenant_invitations_token_hash_uidx').on(t.tokenHash),
  index('tenant_invitations_tenant_idx').on(t.tenantId),
  check('tenant_invitations_status_check', sql`status IN ('pending','accepted','expired','revoked')`),
]);

export const propertyWeeklySummaries = sqliteTable('property_weekly_summaries', {
  id:         id(),
  orgId:      text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  propertyId: text('property_id').notNull().references(() => properties.id, { onDelete: 'cascade' }),
  isoWeek:    text('iso_week').notNull(),  // e.g. '2026-W22'
  body:       text('body').notNull(),
  sentAt:     ts('sent_at').notNull().$defaultFn(() => new Date()),
}, (t) => [
  uniqueIndex('property_weekly_summaries_property_week_uq').on(t.propertyId, t.isoWeek),
]);

export const tenantTasks = sqliteTable('tenant_tasks', {
  id:             id(),
  orgId:          text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  tenantId:       text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  createdBy:      text('created_by').notNull().references(() => profiles.id, { onDelete: 'restrict' }),
  taskType:       text('task_type').notNull(),
  title:          text('title').notNull(),
  description:    text('description'),
  dueAt:          ts('due_at').notNull(),
  reminderSentAt: ts('reminder_sent_at'),
  status:         text('status').notNull().default('pending'),
  completedAt:    ts('completed_at'),
  createdAt:      ts('created_at').notNull().$defaultFn(() => new Date()),
  updatedAt:      ts('updated_at').notNull().$defaultFn(() => new Date()),
}, (t) => [
  index('idx_tt_org_status').on(t.orgId, t.status, t.dueAt),
  index('idx_tt_tenant').on(t.tenantId, t.status),
  index('idx_tt_due_at').on(t.dueAt),
  check('tenant_tasks_task_type_check', sql`task_type IN ('maintenance','document','inspection','cleanup','custom')`),
  check('tenant_tasks_status_check', sql`status IN ('pending','in_progress','proof_pending_review','completed','expired','cancelled')`),
]);

export const taskProofs = sqliteTable('task_proofs', {
  id:                id(),
  orgId:             text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  taskId:            text('task_id').notNull().references(() => tenantTasks.id, { onDelete: 'cascade' }),
  whatsappMessageId: text('whatsapp_message_id').references(() => whatsappMessages.id, { onDelete: 'set null' }),
  imagePath:         text('image_path').notNull(),
  aiVerdict:         text('ai_verdict'),     // 'valid'|'invalid'|'uncertain'
  aiConfidence:      money('ai_confidence'),
  adminDecision:     text('admin_decision'), // 'accepted'|'rejected'
  createdAt:         ts('created_at').notNull().$defaultFn(() => new Date()),
}, (t) => [
  index('idx_tp_task').on(t.taskId, t.createdAt),
  index('idx_tp_org').on(t.orgId, t.createdAt),
  check('task_proofs_ai_verdict_check', sql`ai_verdict IN ('valid','invalid','uncertain')`),
  check('task_proofs_admin_decision_check', sql`admin_decision IN ('accepted','rejected')`),
]);

export const tenantFeedback = sqliteTable('tenant_feedback', {
  id:               id(),
  orgId:            text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  airtableId:       text('airtable_id'),
  airtableSyncedAt: ts('airtable_synced_at'),
  tenantId:         text('tenant_id').references(() => tenants.id, { onDelete: 'set null' }),
  fecha:            dateStr('fecha'),
  cleaningScore:    integer('cleaning_score'),
  coexistenceScore: integer('coexistence_score'),
  attentionScore:   integer('attention_score'),
  securityScore:    integer('security_score'),
  valueScore:       integer('value_score'),
  wouldRecommend:   bool('would_recommend'),
  comment:          text('comment'),
  worstExperience:  text('worst_experience'),
  createdAt:        ts('created_at').notNull().$defaultFn(() => new Date()),
  updatedAt:        ts('updated_at').notNull().$defaultFn(() => new Date()),
}, (t) => [
  index('idx_tenant_feedback_org').on(t.orgId),
  index('idx_tenant_feedback_tenant').on(t.tenantId),
  uniqueIndex('uq_tenant_feedback_airtable').on(t.orgId, t.airtableId),
  check('tenant_feedback_cleaning_score_check', sql`cleaning_score BETWEEN 1 AND 5`),
  check('tenant_feedback_coexistence_score_check', sql`coexistence_score BETWEEN 1 AND 5`),
  check('tenant_feedback_attention_score_check', sql`attention_score BETWEEN 1 AND 5`),
  check('tenant_feedback_security_score_check', sql`security_score BETWEEN 1 AND 5`),
  check('tenant_feedback_value_score_check', sql`value_score BETWEEN 1 AND 5`),
]);

export const owners = sqliteTable('owners', {
  id:                 id(),
  orgId:              text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  airtableExternalId: text('airtable_external_id'),
  airtableSyncedAt:   ts('airtable_synced_at'),
  name:               text('name'),
  dni:                text('dni'),
  phone:              text('phone'),
  email:              text('email'),
  coOwnerName:        text('co_owner_name'),
  coOwnerDni:         text('co_owner_dni'),
  coOwnerPhone:       text('co_owner_phone'),
  coOwnerEmail:       text('co_owner_email'),
  mancomunacion:      text('mancomunacion'),
  apoderamiento:      text('apoderamiento'),
  domicilio:          text('domicilio'),
  distrito:           text('distrito'),
  createdAt:          ts('created_at').notNull().$defaultFn(() => new Date()),
  updatedAt:          ts('updated_at').notNull().$defaultFn(() => new Date()),
}, (t) => [
  index('idx_owners_org').on(t.orgId),
  uniqueIndex('owners_org_airtable_uniq').on(t.orgId, t.airtableExternalId),
]);

export const trashSchedules = sqliteTable('trash_schedules', {
  id:                 id(),
  orgId:              text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  airtableExternalId: text('airtable_external_id'),
  airtableSyncedAt:   ts('airtable_synced_at'),
  name:               text('name'),
  tenantId:           text('tenant_id').references(() => tenants.id, { onDelete: 'set null' }),
  unitId:             text('unit_id').references(() => units.id, { onDelete: 'set null' }),
  zona:               text('zona'),
  dias:               text('dias'),
  activo:             bool('activo').notNull().default(true),
  turnosExtra:        integer('turnos_extra'),
  createdAt:          ts('created_at').notNull().$defaultFn(() => new Date()),
  updatedAt:          ts('updated_at').notNull().$defaultFn(() => new Date()),
}, (t) => [
  index('idx_trash_schedules_org').on(t.orgId),
  uniqueIndex('trash_schedules_org_airtable_uniq').on(t.orgId, t.airtableExternalId),
]);

export const trashCompliance = sqliteTable('trash_compliance', {
  id:                 id(),
  orgId:              text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  airtableExternalId: text('airtable_external_id'),
  airtableSyncedAt:   ts('airtable_synced_at'),
  name:               text('name'),
  trashScheduleId:    text('trash_schedule_id').references(() => trashSchedules.id, { onDelete: 'set null' }),
  tenantId:           text('tenant_id').references(() => tenants.id, { onDelete: 'set null' }),
  fecha:              dateStr('fecha'),
  estado:             text('estado'),
  fotoUrl:            text('foto_url'),
  horaConfirmacion:   ts('hora_confirmacion'),
  hashImagen:         text('hash_imagen'),
  registroTipo:       text('registro_tipo'),
  problemaDescripcion:text('problema_descripcion'),
  createdAt:          ts('created_at').notNull().$defaultFn(() => new Date()),
  updatedAt:          ts('updated_at').notNull().$defaultFn(() => new Date()),
}, (t) => [
  index('idx_trash_compliance_org').on(t.orgId),
  index('idx_trash_compliance_org_fecha').on(t.orgId, t.fecha),
  uniqueIndex('trash_compliance_org_airtable_uniq').on(t.orgId, t.airtableExternalId),
]);

export const absences = sqliteTable('absences', {
  id:                 id(),
  orgId:              text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  airtableExternalId: text('airtable_external_id'),
  airtableSyncedAt:   ts('airtable_synced_at'),
  name:               text('name'),
  tenantId:           text('tenant_id').references(() => tenants.id, { onDelete: 'set null' }),
  fechaInicio:        dateStr('fecha_inicio'),
  fechaFin:           dateStr('fecha_fin'),
  estado:             text('estado'),
  registrado:         ts('registrado'),
  motivo:             text('motivo'),
  createdAt:          ts('created_at').notNull().$defaultFn(() => new Date()),
  updatedAt:          ts('updated_at').notNull().$defaultFn(() => new Date()),
}, (t) => [
  index('idx_absences_org').on(t.orgId),
  uniqueIndex('absences_org_airtable_uniq').on(t.orgId, t.airtableExternalId),
]);

export const amenities = sqliteTable('amenities', {
  id:          id(),
  orgId:       text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  propertyId:  text('property_id').notNull().references(() => properties.id, { onDelete: 'cascade' }),
  name:        text('name').notNull(),
  openTime:    text('open_time').notNull(),
  closeTime:   text('close_time').notNull(),
  slotMinutes: integer('slot_minutes').notNull().default(60),
  capacity:    integer('capacity'),
  active:      bool('active').notNull().default(true),
  createdAt:   ts('created_at').notNull().$defaultFn(() => new Date()),
  updatedAt:   ts('updated_at').notNull().$defaultFn(() => new Date()),
}, (t) => [
  index('idx_amenities_org').on(t.orgId),
  uniqueIndex('amenities_property_name_uniq').on(t.propertyId, t.name),
  check('amenities_slot_minutes_check', sql`slot_minutes BETWEEN 15 AND 720`),
  check('amenities_hours_check', sql`open_time < close_time`),
  check('amenities_capacity_check', sql`capacity IS NULL OR capacity > 0`),
]);

export const amenityBookings = sqliteTable('amenity_bookings', {
  id:        id(),
  orgId:     text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  amenityId: text('amenity_id').notNull().references(() => amenities.id, { onDelete: 'cascade' }),
  tenantId:  text('tenant_id').references(() => tenants.id, { onDelete: 'set null' }),
  bookedOn:  dateStr('booked_on').notNull(),
  startTime: text('start_time').notNull(),
  endTime:   text('end_time').notNull(),
  status:    text('status').notNull().default('confirmed'),
  guestCount: integer('guest_count'),
  comment:   text('comment'),
  createdBy: text('created_by').references(() => profiles.id, { onDelete: 'set null' }),
  createdAt: ts('created_at').notNull().$defaultFn(() => new Date()),
  updatedAt: ts('updated_at').notNull().$defaultFn(() => new Date()),
}, (t) => [
  uniqueIndex('amenity_bookings_slot_uniq').on(t.amenityId, t.bookedOn, t.startTime).where(sql`status = 'confirmed'`),
  index('idx_amenity_bookings_org_date').on(t.orgId, t.bookedOn),
  index('idx_amenity_bookings_tenant').on(t.tenantId),
  check('amenity_bookings_status_check', sql`status IN ('confirmed','cancelled')`),
  check('amenity_bookings_guest_count_check', sql`guest_count IS NULL OR guest_count BETWEEN 1 AND 500`),
]);

export const assets = sqliteTable('assets', {
  id:         id(),
  orgId:      text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  propertyId: text('property_id').notNull().references(() => properties.id, { onDelete: 'cascade' }),
  name:       text('name').notNull(),
  category:   text('category').notNull(),
  location:   text('location'),
  createdAt:  ts('created_at').notNull().$defaultFn(() => new Date()),
  updatedAt:  ts('updated_at').notNull().$defaultFn(() => new Date()),
}, (t) => [
  index('idx_assets_org').on(t.orgId),
  uniqueIndex('assets_property_name_uniq').on(t.propertyId, t.name),
]);

export const assetTasks = sqliteTable('asset_tasks', {
  id:              id(),
  orgId:           text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  assetId:         text('asset_id').notNull().references(() => assets.id, { onDelete: 'cascade' }),
  title:           text('title').notNull(),
  frequencyMonths: integer('frequency_months').notNull(),
  startsOn:        dateStr('starts_on').notNull(),
  responsible:     text('responsible'),
  supplier:        text('supplier'),
  estimatedCost:   money('estimated_cost'),
  createdAt:       ts('created_at').notNull().$defaultFn(() => new Date()),
  updatedAt:       ts('updated_at').notNull().$defaultFn(() => new Date()),
}, (t) => [
  index('idx_asset_tasks_org').on(t.orgId),
  index('idx_asset_tasks_asset').on(t.assetId),
  check('asset_tasks_frequency_check', sql`${t.frequencyMonths} between 1 and 120`),
]);

export const assetTaskLogs = sqliteTable('asset_task_logs', {
  id:        id(),
  orgId:     text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  taskId:    text('task_id').notNull().references(() => assetTasks.id, { onDelete: 'cascade' }),
  doneOn:    dateStr('done_on').notNull(),
  cost:      money('cost'),
  notes:     text('notes'),
  createdBy: text('created_by').references(() => profiles.id, { onDelete: 'set null' }),
  createdAt: ts('created_at').notNull().$defaultFn(() => new Date()),
}, (t) => [
  index('idx_asset_task_logs_task').on(t.taskId, t.doneOn),
  index('idx_asset_task_logs_org').on(t.orgId, t.doneOn),
]);


export const suppliers = sqliteTable('suppliers', {
  id:        id(),
  orgId:     text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  name:      text('name').notNull(),
  trade:     text('trade').notNull(),
  phone:     text('phone'),
  email:     text('email'),
  notes:     text('notes'),
  active:    bool('active').notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  index('idx_suppliers_org_trade').on(t.orgId, t.trade),
  check('suppliers_trade_check', sql`trade IN ('plumbing','electrical','appliance','structural','cleaning','locksmith','painting','general')`),
  check('suppliers_name_check', sql`length(name) > 0`),
]);

export const incidentSupplierAssignments = sqliteTable('incident_supplier_assignments', {
  id:          id(),
  orgId:       text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  incidentId:  text('incident_id').notNull().references(() => incidents.id, { onDelete: 'cascade' }),
  supplierId:  text('supplier_id').notNull().references(() => suppliers.id, { onDelete: 'restrict' }),
  status:      text('status').notNull().default('assigned'),
  quoteAmount: money('quote_amount'),
  finalCost:   money('final_cost'),
  notes:       text('notes'),
  assignedBy:  text('assigned_by').references(() => profiles.id, { onDelete: 'set null' }),
  createdAt:   createdAt(),
  updatedAt:   updatedAt(),
}, (t) => [
  uniqueIndex('incident_supplier_assignments_incident_uniq').on(t.incidentId),
  index('idx_incident_supplier_assignments_org_supplier').on(t.orgId, t.supplierId),
  check('incident_supplier_assignments_status_check', sql`status IN ('assigned','quoted','approved','done','cancelled')`),
]);

export const propertyOwnerTerms = sqliteTable('property_owner_terms', {
  id:            id(),
  orgId:         text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  propertyId:    text('property_id').notNull().references(() => properties.id, { onDelete: 'cascade' }),
  ownerId:       text('owner_id').notNull().references(() => owners.id, { onDelete: 'cascade' }),
  commissionPct: money('commission_pct').notNull().default('0'),
  createdAt:     ts('created_at').notNull().$defaultFn(() => new Date()),
  updatedAt:     ts('updated_at').notNull().$defaultFn(() => new Date()),
}, (t) => [
  uniqueIndex('property_owner_terms_property_uniq').on(t.propertyId),
  index('idx_property_owner_terms_org_owner').on(t.orgId, t.ownerId),
  check('property_owner_terms_commission_check', sql`CAST(commission_pct AS REAL) >= 0 AND CAST(commission_pct AS REAL) <= 100`),
]);
