/**
 * Drizzle schema — PropFlow
 *
 * 46 domain tables mirroring the Supabase migration history,
 * plus 4 NextAuth tables required by @auth/drizzle-adapter.
 *
 * NOTE: No RLS policies — isolation is enforced at the app layer
 * via eq(t.orgId, session.orgId) on every query.
 */

import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  numeric,
  integer,
  jsonb,
  date,
  inet,
  primaryKey,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';

// ─────────────────────────────────────────────────────────────────────────────
// NextAuth tables (required by @auth/drizzle-adapter)
// ─────────────────────────────────────────────────────────────────────────────

export const users = pgTable('users', {
  id:            uuid('id').primaryKey().defaultRandom(),
  name:          text('name'),
  email:         text('email').unique(),
  emailVerified: timestamp('email_verified', { withTimezone: true }),
  image:         text('image'),
  // Credentials provider: bcrypt hash stored here (never in plain text)
  passwordHash:  text('password_hash'),
});

export const accounts = pgTable(
  'accounts',
  {
    userId:            uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
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
  (t) => ({
    pk: primaryKey({ columns: [t.provider, t.providerAccountId] }),
  }),
);

export const sessions = pgTable('sessions', {
  sessionToken: text('session_token').primaryKey(),
  userId:       uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  expires:      timestamp('expires', { withTimezone: true }).notNull(),
});

export const verificationTokens = pgTable(
  'verification_tokens',
  {
    identifier: text('identifier').notNull(),
    token:      text('token').notNull(),
    expires:    timestamp('expires', { withTimezone: true }).notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.identifier, t.token] }),
  }),
);

// ─────────────────────────────────────────────────────────────────────────────
// Domain table 1: organizations
// ─────────────────────────────────────────────────────────────────────────────

export const organizations = pgTable('organizations', {
  id:        uuid('id').primaryKey().defaultRandom(),
  name:      text('name').notNull(),
  slug:      text('slug').unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ─────────────────────────────────────────────────────────────────────────────
// Domain table 2: profiles (1:1 with NextAuth users via user_id FK)
//
// Key change vs Supabase: `id` is no longer a FK to auth.users.
// Instead, `user_id` is the FK to NextAuth `users.id` ON DELETE CASCADE.
// ─────────────────────────────────────────────────────────────────────────────

export const profiles = pgTable('profiles', {
  id:                uuid('id').primaryKey().defaultRandom(),
  // NEW FK — replaces old profiles.id → auth.users(id)
  userId:            uuid('user_id').unique().references(() => users.id, { onDelete: 'cascade' }),
  orgId:             uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  role:              text('role').notNull(),  // 'admin' | 'tenant'
  fullName:          text('full_name'),
  email:             text('email'),
  phone:             text('phone'),
  preferredLanguage: text('preferred_language'),
  termsAcceptedAt:   timestamp('terms_accepted_at', { withTimezone: true }),
  termsVersion:      text('terms_version'),
  privacyAcceptedAt: timestamp('privacy_accepted_at', { withTimezone: true }),
  privacyVersion:    text('privacy_version'),
  createdAt:         timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:         timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  orgIdx:     index('idx_profiles_org_id').on(t.orgId),
  orgRoleIdx: index('idx_profiles_org_role').on(t.orgId, t.role),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Domain table 3: properties
// ─────────────────────────────────────────────────────────────────────────────

export const properties = pgTable('properties', {
  id:                 uuid('id').primaryKey().defaultRandom(),
  orgId:              uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  name:               text('name').notNull(),
  address:            text('address'),
  city:               text('city'),
  country:            text('country'),
  airtableExternalId: text('airtable_external_id'),
  airtableSyncedAt:   timestamp('airtable_synced_at', { withTimezone: true }),
  topeLuz:            numeric('tope_luz'),
  topeAgua:           numeric('tope_agua'),
  createdAt:          timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:          timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  orgIdx:        index('idx_properties_org_id').on(t.orgId),
  airtableUniq:  uniqueIndex('properties_org_airtable_uniq').on(t.orgId, t.airtableExternalId),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Domain table 4: units
// ─────────────────────────────────────────────────────────────────────────────

export const units = pgTable('units', {
  id:                  uuid('id').primaryKey().defaultRandom(),
  orgId:               uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  propertyId:          uuid('property_id').notNull().references(() => properties.id, { onDelete: 'cascade' }),
  label:               text('label').notNull(),
  floor:               text('floor'),
  bedrooms:            integer('bedrooms'),
  monthlyRentDefault:  numeric('monthly_rent_default', { precision: 12, scale: 2 }),
  status:              text('status').notNull().default('vacant'),  // 'vacant' | 'occupied'
  toiletType:          text('toilet_type').notNull().default('private'),  // 'shared' | 'private' | 'none'
  airtableExternalId:  text('airtable_external_id'),
  airtableSyncedAt:    timestamp('airtable_synced_at', { withTimezone: true }),
  areaM2:              numeric('area_m2'),
  createdAt:           timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:           timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  orgIdx:        index('idx_units_org_id').on(t.orgId),
  propertyIdx:   index('idx_units_property_id').on(t.propertyId),
  airtableUniq:  uniqueIndex('units_org_airtable_uniq').on(t.orgId, t.airtableExternalId),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Domain table 5: responsables (Airtable-synced contact persons)
// ─────────────────────────────────────────────────────────────────────────────

export const responsables = pgTable('responsables', {
  id:                 uuid('id').primaryKey().defaultRandom(),
  orgId:              uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  airtableExternalId: text('airtable_external_id'),
  airtableSyncedAt:   timestamp('airtable_synced_at', { withTimezone: true }),
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
  createdAt:          timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt:          timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (t) => ({
  airtableUniq: uniqueIndex('responsables_org_airtable_uniq').on(t.orgId, t.airtableExternalId),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Domain table 6: tenants
// ─────────────────────────────────────────────────────────────────────────────

export const tenants = pgTable('tenants', {
  id:                    uuid('id').primaryKey().defaultRandom(),
  orgId:                 uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  profileId:             uuid('profile_id').references(() => profiles.id, { onDelete: 'set null' }),
  responsableId:         uuid('responsable_id').references(() => responsables.id, { onDelete: 'set null' }),
  fullName:              text('full_name').notNull(),
  email:                 text('email'),
  phone:                 text('phone'),
  unitId:                uuid('unit_id').references(() => units.id, { onDelete: 'set null' }),
  notes:                 text('notes'),
  preferredLanguage:     text('preferred_language').notNull().default('es'),
  photoUrl:              text('photo_url'),
  whatsappPhone:         text('whatsapp_phone'),
  whatsappOptIn:         boolean('whatsapp_opt_in').notNull().default(false),
  reliabilityScores:     jsonb('reliability_scores').notNull().default({}),
  airtableExternalId:    text('airtable_external_id'),
  airtableSyncedAt:      timestamp('airtable_synced_at', { withTimezone: true }),
  syncStatus:            text('sync_status').notNull().default('pending'),
  lastSyncedAt:          timestamp('last_synced_at', { withTimezone: true }),
  portalAccess:          text('portal_access').notNull().default('not_invited'),
  emergencyContactName:  text('emergency_contact_name'),
  emergencyContactPhone: text('emergency_contact_phone'),
  externalTenantId:      text('external_tenant_id'),
  documentNumber:        text('document_number'),
  dateOfBirth:           date('date_of_birth'),
  moveInDate:            date('move_in_date'),
  importSource:          text('import_source').default('manual'),
  createdAt:             timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:             timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  orgIdx:        index('idx_tenants_org_id').on(t.orgId),
  orgUnitIdx:    index('idx_tenants_org_unit').on(t.orgId, t.unitId),
  profileIdx:    index('idx_tenants_profile_id').on(t.profileId),
  airtableUniq:  uniqueIndex('tenants_org_airtable_uniq').on(t.orgId, t.airtableExternalId),
  extIdUniq:     uniqueIndex('tenants_org_external_id_uidx').on(t.orgId, t.externalTenantId),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Domain table 7: contracts
// ─────────────────────────────────────────────────────────────────────────────

export const contracts = pgTable('contracts', {
  id:                 uuid('id').primaryKey().defaultRandom(),
  orgId:              uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  tenantId:           uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  unitId:             uuid('unit_id').notNull().references(() => units.id, { onDelete: 'cascade' }),
  startDate:          date('start_date').notNull(),
  endDate:            date('end_date'),  // nullable — open-ended contracts (migration 052)
  monthlyRent:        numeric('monthly_rent', { precision: 12, scale: 2 }).notNull(),
  status:             text('status').notNull().default('active'),  // 'active' | 'expired' | 'terminated'
  deposit:            numeric('deposit', { precision: 12, scale: 2 }),
  documentUrl:        text('document_url'),
  signedAt:           timestamp('signed_at', { withTimezone: true }),
  signatureStatus:    text('signature_status'),  // 'pending_signature' | 'signed' | 'declined'
  airtableExternalId: text('airtable_external_id'),
  airtableSyncedAt:   timestamp('airtable_synced_at', { withTimezone: true }),
  createdAt:          timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:          timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  orgIdx:       index('idx_contracts_org_id').on(t.orgId),
  tenantIdx:    index('idx_contracts_tenant_id').on(t.tenantId),
  unitIdx:      index('idx_contracts_unit_id').on(t.unitId),
  orgStatusIdx: index('idx_contracts_org_status').on(t.orgId, t.status),
  airtableUniq: uniqueIndex('contracts_org_airtable_uniq').on(t.orgId, t.airtableExternalId),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Domain table 8: charges
// ─────────────────────────────────────────────────────────────────────────────

export const charges = pgTable('charges', {
  id:          uuid('id').primaryKey().defaultRandom(),
  orgId:       uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  contractId:  uuid('contract_id').notNull().references(() => contracts.id, { onDelete: 'cascade' }),
  tenantId:    uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  period:      date('period'),
  description: text('description'),
  amount:      numeric('amount', { precision: 12, scale: 2 }).notNull(),
  dueDate:     date('due_date'),
  createdAt:   timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:   timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  orgIdx:        index('idx_charges_org_id').on(t.orgId),
  contractIdx:   index('idx_charges_contract_id').on(t.contractId),
  tenantPeriod:  index('idx_charges_tenant_period').on(t.tenantId, t.period),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Domain table 9: import_logs (referenced by payments.import_id)
// Created before payments to satisfy FK order
// ─────────────────────────────────────────────────────────────────────────────

export const importLogs = pgTable('import_logs', {
  id:                  uuid('id').primaryKey().defaultRandom(),
  orgId:               uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  importType:          text('import_type').notNull(),  // 'tenant'|'payment'|'room_performance'|'financial'
  fileName:            text('file_name'),
  importedBy:          uuid('imported_by').references(() => profiles.id, { onDelete: 'set null' }),
  role:                text('role'),
  status:              text('status').notNull().default('pending'),
  rowsReceived:        integer('rows_received').default(0),
  rowsCreated:         integer('rows_created').default(0),
  rowsUpdated:         integer('rows_updated').default(0),
  rowsSkipped:         integer('rows_skipped').default(0),
  rowsFailed:          integer('rows_failed').default(0),
  validationWarnings:  jsonb('validation_warnings').default([]),
  errorDetails:        jsonb('error_details').default([]),
  airtableSyncResult:  jsonb('airtable_sync_result'),
  createdAt:           timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  completedAt:         timestamp('completed_at', { withTimezone: true }),
});

// ─────────────────────────────────────────────────────────────────────────────
// Domain table 10: payments
// ─────────────────────────────────────────────────────────────────────────────

export const payments = pgTable('payments', {
  id:                 uuid('id').primaryKey().defaultRandom(),
  orgId:              uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  contractId:         uuid('contract_id').notNull().references(() => contracts.id, { onDelete: 'cascade' }),
  tenantId:           uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  amount:             numeric('amount', { precision: 12, scale: 2 }).notNull(),
  paidAt:             date('paid_at').notNull(),
  method:             text('method').notNull().default('transfer'),  // 'cash'|'transfer'|'card'|'other'
  status:             text('status').notNull().default('pending'),   // 'pending'|'approved'|'under_review'|'rejected'
  approvedBy:         uuid('approved_by').references(() => profiles.id, { onDelete: 'set null' }),
  approvedAt:         timestamp('approved_at', { withTimezone: true }),
  reference:          text('reference'),
  currency:           text('currency').notNull().default('PEN'),
  receiptUrl:         text('receipt_url'),
  movementType:       text('movement_type').notNull().default('payment'),
  externalPaymentId:  text('external_payment_id'),
  importSource:       text('import_source').default('manual'),
  importId:           uuid('import_id').references(() => importLogs.id, { onDelete: 'set null' }),
  airtableExternalId: text('airtable_external_id'),
  airtableSyncedAt:   timestamp('airtable_synced_at', { withTimezone: true }),
  createdAt:          timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:          timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  orgIdx:           index('idx_payments_org_id').on(t.orgId),
  contractIdx:      index('idx_payments_contract_id').on(t.contractId),
  tenantIdx:        index('idx_payments_tenant_id').on(t.tenantId),
  orgStatusIdx:     index('idx_payments_org_status').on(t.orgId, t.status),
  airtableUniq:     uniqueIndex('payments_org_airtable_uniq').on(t.orgId, t.airtableExternalId),
  extPaymentUniq:   uniqueIndex('payments_org_external_id_uidx').on(t.orgId, t.externalPaymentId),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Domain table 11: incidents
// ─────────────────────────────────────────────────────────────────────────────

export const incidents = pgTable('incidents', {
  id:                 uuid('id').primaryKey().defaultRandom(),
  orgId:              uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  unitId:             uuid('unit_id').references(() => units.id, { onDelete: 'set null' }),
  propertyId:         uuid('property_id').references(() => properties.id, { onDelete: 'set null' }),
  createdBy:          uuid('created_by').references(() => profiles.id, { onDelete: 'cascade' }),  // nullable after migration 054
  tenantId:           uuid('tenant_id').references(() => tenants.id, { onDelete: 'set null' }),
  assignedTo:         uuid('assigned_to').references(() => profiles.id, { onDelete: 'set null' }),
  category:           text('category').notNull(),
  title:              text('title').notNull(),
  description:        text('description').notNull(),
  priority:           text('priority').notNull().default('medium'),  // 'low'|'medium'|'high'|'urgent'
  status:             text('status').notNull().default('pending'),   // 'pending'|'in_progress'|'solved'
  photoPath:          text('photo_path'),
  resolvedAt:         timestamp('resolved_at', { withTimezone: true }),
  cost:               numeric('cost'),
  airtableExternalId: text('airtable_external_id'),
  airtableSyncedAt:   timestamp('airtable_synced_at', { withTimezone: true }),
  createdAt:          timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:          timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  orgIdx:       index('idx_incidents_org_id').on(t.orgId),
  orgStatusIdx: index('idx_incidents_org_status').on(t.orgId, t.status),
  createdByIdx: index('idx_incidents_created_by').on(t.createdBy),
  assignedIdx:  index('idx_incidents_assigned_to').on(t.assignedTo),
  airtableUniq: uniqueIndex('incidents_org_airtable_uniq').on(t.orgId, t.airtableExternalId),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Domain table 12: incident_comments
// ─────────────────────────────────────────────────────────────────────────────

export const incidentComments = pgTable('incident_comments', {
  id:         uuid('id').primaryKey().defaultRandom(),
  orgId:      uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  incidentId: uuid('incident_id').notNull().references(() => incidents.id, { onDelete: 'cascade' }),
  authorId:   uuid('author_id').notNull().references(() => profiles.id, { onDelete: 'cascade' }),
  body:       text('body').notNull(),
  createdAt:  timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:  timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  orgIdx:        index('idx_incident_comments_org_id').on(t.orgId),
  incidentTsIdx: index('idx_incident_comments_incident_time').on(t.incidentId, t.createdAt),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Domain table 13: internal_notes
// ─────────────────────────────────────────────────────────────────────────────

export const internalNotes = pgTable('internal_notes', {
  id:        uuid('id').primaryKey().defaultRandom(),
  orgId:     uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  tenantId:  uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  content:   text('content').notNull(),
  createdBy: uuid('created_by').notNull().references(() => profiles.id, { onDelete: 'restrict' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  tenantIdx: index('idx_internal_notes_tenant').on(t.tenantId, t.createdAt),
  orgIdx:    index('idx_internal_notes_org').on(t.orgId, t.createdAt),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Domain table 14: expense_categories
// ─────────────────────────────────────────────────────────────────────────────

export const expenseCategories = pgTable('expense_categories', {
  id:        uuid('id').primaryKey().defaultRandom(),
  orgId:     uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  name:      text('name').notNull(),
  color:     text('color'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  orgIdx:     index('idx_expense_categories_org').on(t.orgId),
  orgNameUniq: uniqueIndex('expense_categories_org_name_uniq').on(t.orgId, t.name),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Domain table 15: expenses
// ─────────────────────────────────────────────────────────────────────────────

export const expenses = pgTable('expenses', {
  id:          uuid('id').primaryKey().defaultRandom(),
  orgId:       uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  propertyId:  uuid('property_id').references(() => properties.id, { onDelete: 'set null' }),
  unitId:      uuid('unit_id').references(() => units.id, { onDelete: 'set null' }),
  categoryId:  uuid('category_id').references(() => expenseCategories.id, { onDelete: 'set null' }),
  amount:      numeric('amount', { precision: 12, scale: 2 }).notNull(),
  description: text('description').notNull(),
  incurredOn:  date('incurred_on').notNull(),
  receiptPath: text('receipt_path'),
  createdAt:   timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:   timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  orgIdx:      index('idx_expenses_org').on(t.orgId),
  orgDateIdx:  index('idx_expenses_org_date').on(t.orgId, t.incurredOn),
  propertyIdx: index('idx_expenses_property').on(t.propertyId),
  categoryIdx: index('idx_expenses_category').on(t.categoryId),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Domain table 16: receipt_uploads
// ─────────────────────────────────────────────────────────────────────────────

export const receiptUploads = pgTable('receipt_uploads', {
  id:              uuid('id').primaryKey().defaultRandom(),
  orgId:           uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  paymentId:       uuid('payment_id').references(() => payments.id, { onDelete: 'set null' }),
  uploadedBy:      uuid('uploaded_by').notNull().references(() => profiles.id, { onDelete: 'cascade' }),
  filePath:        text('file_path').notNull(),
  ocrStatus:       text('ocr_status').notNull().default('pending'),
  extractedAmount: numeric('extracted_amount', { precision: 12, scale: 2 }),
  extractedDate:   date('extracted_date'),
  extractedVendor: text('extracted_vendor'),
  confidence:      numeric('confidence', { precision: 4, scale: 3 }),
  ocrError:        text('ocr_error'),
  createdAt:       timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:       timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  orgIdx:       index('idx_receipt_uploads_org').on(t.orgId),
  orgStatusIdx: index('idx_receipt_uploads_org_status').on(t.orgId, t.ocrStatus),
  paymentIdx:   index('idx_receipt_uploads_payment').on(t.paymentId),
  uploaderIdx:  index('idx_receipt_uploads_uploader').on(t.uploadedBy),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Domain table 17: contract_templates
// ─────────────────────────────────────────────────────────────────────────────

export const contractTemplates = pgTable('contract_templates', {
  id:           uuid('id').primaryKey().defaultRandom(),
  orgId:        uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  name:         text('name').notNull(),
  bodyMarkdown: text('body_markdown').notNull(),
  variables:    jsonb('variables').notNull().default([]),
  createdAt:    timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:    timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  orgIdx:    index('idx_contract_templates_org').on(t.orgId),
  nameUniq:  uniqueIndex('contract_templates_org_name_uniq').on(t.orgId, t.name),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Domain table 18: pricing_tables
// ─────────────────────────────────────────────────────────────────────────────

export const pricingTables = pgTable('pricing_tables', {
  id:           uuid('id').primaryKey().defaultRandom(),
  orgId:        uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  name:         text('name').notNull(),
  propertyType: text('property_type').notNull(),
  marketZone:   text('market_zone').notNull(),
  tiers:        jsonb('tiers').notNull().default([]),
  createdAt:    timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:    timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  orgIdx:    index('idx_pricing_tables_org').on(t.orgId),
  typeIdx:   index('idx_pricing_tables_org_type').on(t.orgId, t.propertyType, t.marketZone),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Domain table 19: crm_leads
// ─────────────────────────────────────────────────────────────────────────────

export const crmLeads = pgTable('crm_leads', {
  id:               uuid('id').primaryKey().defaultRandom(),
  orgId:            uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  fullName:         text('full_name').notNull(),
  email:            text('email'),
  phone:            text('phone'),
  propertyInterest: text('property_interest'),
  source:           text('source'),
  status:           text('status').notNull().default('new'),  // 'new'|'contacted'|'qualified'|'lost'
  notes:            text('notes'),
  createdAt:        timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:        timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  orgIdx:       index('idx_crm_leads_org').on(t.orgId),
  orgStatusIdx: index('idx_crm_leads_org_status').on(t.orgId, t.status),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Domain table 20: community_posts
// ─────────────────────────────────────────────────────────────────────────────

export const communityPosts = pgTable('community_posts', {
  id:        uuid('id').primaryKey().defaultRandom(),
  orgId:     uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  authorId:  uuid('author_id').notNull().references(() => profiles.id, { onDelete: 'cascade' }),
  title:     text('title').notNull(),
  body:      text('body').notNull(),
  category:  text('category').notNull().default('general'),
  pinned:    boolean('pinned').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  orgIdx:        index('idx_community_posts_org').on(t.orgId),
  orgPinnedIdx:  index('idx_community_posts_org_pinned').on(t.orgId, t.pinned, t.createdAt),
  authorIdx:     index('idx_community_posts_author').on(t.authorId),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Domain table 21: community_comments
// ─────────────────────────────────────────────────────────────────────────────

export const communityComments = pgTable('community_comments', {
  id:        uuid('id').primaryKey().defaultRandom(),
  orgId:     uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  postId:    uuid('post_id').notNull().references(() => communityPosts.id, { onDelete: 'cascade' }),
  authorId:  uuid('author_id').notNull().references(() => profiles.id, { onDelete: 'cascade' }),
  body:      text('body').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  orgIdx:     index('idx_community_comments_org').on(t.orgId),
  postTsIdx:  index('idx_community_comments_post_ts').on(t.postId, t.createdAt),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Domain table 22: announcements
// ─────────────────────────────────────────────────────────────────────────────

export const announcements = pgTable('announcements', {
  id:          uuid('id').primaryKey().defaultRandom(),
  orgId:       uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  createdBy:   uuid('created_by').notNull().references(() => profiles.id, { onDelete: 'cascade' }),
  title:       text('title').notNull(),
  body:        text('body').notNull(),
  audience:    text('audience').notNull().default('all'),  // 'all'|'property'|'unit'
  propertyId:  uuid('property_id').references(() => properties.id, { onDelete: 'set null' }),
  unitId:      uuid('unit_id').references(() => units.id, { onDelete: 'set null' }),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  expiresAt:   timestamp('expires_at', { withTimezone: true }),
  createdAt:   timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:   timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  orgIdx:      index('idx_announcements_org').on(t.orgId),
  orgPubIdx:   index('idx_announcements_org_pub').on(t.orgId, t.publishedAt),
  propertyIdx: index('idx_announcements_property').on(t.propertyId),
  unitIdx:     index('idx_announcements_unit').on(t.unitId),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Domain table 23: cleaning_tasks
// ─────────────────────────────────────────────────────────────────────────────

export const cleaningTasks = pgTable('cleaning_tasks', {
  id:            uuid('id').primaryKey().defaultRandom(),
  orgId:         uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  unitId:        uuid('unit_id').references(() => units.id, { onDelete: 'set null' }),
  assignedTo:    uuid('assigned_to').references(() => profiles.id, { onDelete: 'set null' }),
  title:         text('title').notNull(),
  scheduledDate: date('scheduled_date').notNull(),
  status:        text('status').notNull().default('pending'),  // 'pending'|'in_progress'|'done'
  notes:         text('notes'),
  completedAt:   timestamp('completed_at', { withTimezone: true }),
  createdAt:     timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:     timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  orgIdx:      index('idx_cleaning_tasks_org').on(t.orgId),
  orgDateIdx:  index('idx_cleaning_tasks_org_date').on(t.orgId, t.scheduledDate),
  unitIdx:     index('idx_cleaning_tasks_unit').on(t.unitId),
  assigneeIdx: index('idx_cleaning_tasks_assignee').on(t.assignedTo),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Domain table 24: signature_requests
// ─────────────────────────────────────────────────────────────────────────────

export const signatureRequests = pgTable('signature_requests', {
  id:                 uuid('id').primaryKey().defaultRandom(),
  orgId:              uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  contractId:         uuid('contract_id').notNull().references(() => contracts.id, { onDelete: 'cascade' }),
  signerProfileId:    uuid('signer_profile_id').references(() => profiles.id, { onDelete: 'set null' }),
  signerEmail:        text('signer_email').notNull(),
  token:              uuid('token').notNull().unique().defaultRandom(),
  status:             text('status').notNull().default('sent'),  // 'sent'|'viewed'|'signed'|'declined'|'expired'
  sentAt:             timestamp('sent_at', { withTimezone: true }).notNull().defaultNow(),
  viewedAt:           timestamp('viewed_at', { withTimezone: true }),
  signedAt:           timestamp('signed_at', { withTimezone: true }),
  expiresAt:          timestamp('expires_at', { withTimezone: true }).notNull(),
  signatureImagePath: text('signature_image_path'),
  signedIp:           inet('signed_ip'),
  signedUserAgent:    text('signed_user_agent'),
  createdAt:          timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:          timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  orgIdx:      index('idx_signature_requests_org').on(t.orgId),
  contractIdx: index('idx_signature_requests_contract').on(t.contractId),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Domain table 25: reminders
// ─────────────────────────────────────────────────────────────────────────────

export const reminders = pgTable('reminders', {
  id:             uuid('id').primaryKey().defaultRandom(),
  orgId:          uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  type:           text('type').notNull(),        // 'lease_renewal'|'payment_due'|'custom'
  targetType:     text('target_type').notNull(), // 'contract'|'charge'|'tenant'
  targetId:       uuid('target_id').notNull(),
  channel:        text('channel').notNull().default('both'),  // 'email'|'in_app'|'both'
  scheduledFor:   date('scheduled_for').notNull(),
  sentAt:         timestamp('sent_at', { withTimezone: true }),
  status:         text('status').notNull().default('scheduled'),  // 'scheduled'|'sent'|'failed'|'skipped'
  messagePreview: text('message_preview'),
  error:          text('error'),
  createdAt:      timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:      timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  orgIdx:         index('idx_reminders_org').on(t.orgId),
  orgDateStatus:  index('idx_reminders_org_date_status').on(t.orgId, t.scheduledFor, t.status),
  targetIdx:      index('idx_reminders_target').on(t.targetType, t.targetId),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Domain table 26: notification_inbox
// ─────────────────────────────────────────────────────────────────────────────

export const notificationInbox = pgTable('notification_inbox', {
  id:          uuid('id').primaryKey().defaultRandom(),
  orgId:       uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  profileId:   uuid('profile_id').notNull().references(() => profiles.id, { onDelete: 'cascade' }),
  type:        text('type').notNull(),
  title:       text('title').notNull(),
  body:        text('body').notNull(),
  relatedType: text('related_type'),
  relatedId:   uuid('related_id'),
  readAt:      timestamp('read_at', { withTimezone: true }),
  createdAt:   timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:   timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  orgIdx:         index('idx_notification_inbox_org').on(t.orgId),
  profileReadIdx: index('idx_notification_inbox_profile_read').on(t.profileId, t.readAt),
  profileTsIdx:   index('idx_notification_inbox_profile_ts').on(t.profileId, t.createdAt),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Domain table 27: visitor_logs
// ─────────────────────────────────────────────────────────────────────────────

export const visitorLogs = pgTable('visitor_logs', {
  id:           uuid('id').primaryKey().defaultRandom(),
  orgId:        uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  propertyId:   uuid('property_id').references(() => properties.id, { onDelete: 'set null' }),
  unitId:       uuid('unit_id').references(() => units.id, { onDelete: 'set null' }),
  visitorName:  text('visitor_name').notNull(),
  hostTenantId: uuid('host_tenant_id').references(() => tenants.id, { onDelete: 'set null' }),
  visitDate:    date('visit_date').notNull(),
  entryTime:    timestamp('entry_time', { withTimezone: true }),
  exitTime:     timestamp('exit_time', { withTimezone: true }),
  purpose:      text('purpose'),
  createdBy:    uuid('created_by').notNull().references(() => profiles.id, { onDelete: 'cascade' }),
  notes:        text('notes'),
  createdAt:    timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:    timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  orgIdx:      index('idx_visitor_logs_org').on(t.orgId),
  orgDateIdx:  index('idx_visitor_logs_org_date').on(t.orgId, t.visitDate),
  unitIdx:     index('idx_visitor_logs_unit').on(t.unitId),
  hostIdx:     index('idx_visitor_logs_host').on(t.hostTenantId),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Domain table 28: ai_chat_messages
// ─────────────────────────────────────────────────────────────────────────────

export const aiChatMessages = pgTable('ai_chat_messages', {
  id:        uuid('id').primaryKey().defaultRandom(),
  orgId:     uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  profileId: uuid('profile_id').notNull().references(() => profiles.id, { onDelete: 'cascade' }),
  sessionId: uuid('session_id').notNull(),
  role:      text('role').notNull(),  // 'user' | 'assistant'
  content:   text('content').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  // no updated_at — immutable rows
}, (t) => ({
  orgIdx:       index('idx_ai_chat_org').on(t.orgId),
  sessionTsIdx: index('idx_ai_chat_session_ts').on(t.profileId, t.sessionId, t.createdAt),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Domain table 29: whatsapp_conversations
// ─────────────────────────────────────────────────────────────────────────────

export const whatsappConversations = pgTable('whatsapp_conversations', {
  id:               uuid('id').primaryKey().defaultRandom(),
  orgId:            uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  tenantId:         uuid('tenant_id').references(() => tenants.id, { onDelete: 'set null' }),
  externalPhone:    text('external_phone').notNull(),
  lastMessageAt:    timestamp('last_message_at', { withTimezone: true }),
  unreadCountAdmin: integer('unread_count_admin').notNull().default(0),
  createdAt:        timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:        timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  orgLastIdx:   index('idx_wa_conv_org_last').on(t.orgId, t.lastMessageAt),
  tenantIdx:    index('idx_wa_conv_tenant').on(t.tenantId),
  phonePerOrg:  uniqueIndex('whatsapp_conversations_phone_per_org').on(t.orgId, t.externalPhone),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Domain table 30: whatsapp_messages
// ─────────────────────────────────────────────────────────────────────────────

export const whatsappMessages = pgTable('whatsapp_messages', {
  id:                uuid('id').primaryKey().defaultRandom(),
  orgId:             uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  conversationId:    uuid('conversation_id').notNull().references(() => whatsappConversations.id, { onDelete: 'cascade' }),
  direction:         text('direction').notNull(),  // 'inbound' | 'outbound'
  providerMessageId: text('provider_message_id'),
  body:              text('body'),
  attachmentPath:    text('attachment_path'),
  attachmentKind:    text('attachment_kind'),    // 'image'|'document'|'audio'|'video'
  classification:    text('classification'),     // 'receipt'|'task-proof'|'incident-evidence'|'other'
  status:            text('status').notNull().default('received'),
  meta:              jsonb('meta').notNull().default({}),
  createdAt:         timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  convIdx:       index('idx_wa_msg_conv').on(t.conversationId, t.createdAt),
  orgStatusIdx:  index('idx_wa_msg_org_status').on(t.orgId, t.status, t.createdAt),
  providerUniq:  uniqueIndex('whatsapp_messages_provider_id_per_org').on(t.orgId, t.providerMessageId),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Domain table 31: payment_receipts
// ─────────────────────────────────────────────────────────────────────────────

export const paymentReceipts = pgTable('payment_receipts', {
  id:               uuid('id').primaryKey().defaultRandom(),
  orgId:            uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  tenantId:         uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  source:           text('source').notNull().default('whatsapp'),  // 'whatsapp' | 'manual'
  whatsappMessageId: uuid('whatsapp_message_id').references(() => whatsappMessages.id, { onDelete: 'set null' }),
  imagePath:        text('image_path').notNull(),
  imageSha256:      text('image_sha256').notNull(),
  extractedAmount:  numeric('extracted_amount', { precision: 12, scale: 2 }),
  extractedDate:    date('extracted_date'),
  extractedVendor:  text('extracted_vendor'),
  confidence:       numeric('confidence', { precision: 4, scale: 3 }),
  matchedChargeId:  uuid('matched_charge_id').references(() => charges.id, { onDelete: 'set null' }),
  matchedPaymentId: uuid('matched_payment_id').references(() => payments.id, { onDelete: 'set null' }),
  status:           text('status').notNull().default('pending_review'),
  rejectionReason:  text('rejection_reason'),
  createdAt:        timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:        timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  orgStatusIdx: index('idx_pr_org_status').on(t.orgId, t.status, t.createdAt),
  tenantIdx:    index('idx_pr_tenant').on(t.tenantId, t.createdAt),
  sha256Idx:    index('idx_pr_sha256').on(t.imageSha256),
  sha256Uniq:   uniqueIndex('payment_receipts_sha256_per_org').on(t.orgId, t.imageSha256),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Domain table 32: airtable_snapshots
// ─────────────────────────────────────────────────────────────────────────────

export const airtableSnapshots = pgTable('airtable_snapshots', {
  id:         uuid('id').primaryKey().defaultRandom(),
  orgId:      uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  tableName:  text('table_name').notNull(),
  externalId: text('external_id').notNull(),
  data:       jsonb('data').notNull(),
  syncedAt:   timestamp('synced_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  orgTableIdx:  index('idx_airtable_snapshots_org_table').on(t.orgId, t.tableName),
  syncedAtIdx:  index('idx_airtable_snapshots_synced_at').on(t.orgId, t.syncedAt),
  orgTableExtUniq: uniqueIndex('airtable_snapshots_org_table_external_uq').on(t.orgId, t.tableName, t.externalId),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Domain table 33: airtable_sync_logs
// ─────────────────────────────────────────────────────────────────────────────

export const airtableSyncLogs = pgTable('airtable_sync_logs', {
  id:              uuid('id').primaryKey().defaultRandom(),
  orgId:           uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  tableName:       text('table_name').notNull(),
  status:          text('status').notNull(),  // 'success'|'error'|'partial'
  recordsUpserted: integer('records_upserted').notNull().default(0),
  errorMessage:    text('error_message'),
  startedAt:       timestamp('started_at', { withTimezone: true }).notNull(),
  completedAt:     timestamp('completed_at', { withTimezone: true }),
}, (t) => ({
  orgStartedIdx:  index('idx_airtable_sync_logs_org_started').on(t.orgId, t.startedAt),
  tableNameIdx:   index('idx_airtable_sync_logs_table_name').on(t.orgId, t.tableName),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Domain table 34: csv_imports
// ─────────────────────────────────────────────────────────────────────────────

export const csvImports = pgTable('csv_imports', {
  id:               uuid('id').primaryKey().defaultRandom(),
  orgId:            uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  importType:       text('import_type').notNull(),
  originalFilename: text('original_filename').notNull(),
  period:           text('period').notNull(),
  status:           text('status').notNull(),  // 'dry_run'|'committed'|'failed'
  rowCount:         integer('row_count').notNull().default(0),
  failedCount:      integer('failed_count').notNull().default(0),
  errorSummary:     jsonb('error_summary').notNull().default([]),
  committedAt:      timestamp('committed_at', { withTimezone: true }),
  createdBy:        uuid('created_by').notNull().references(() => profiles.id, { onDelete: 'restrict' }),
  createdAt:        timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  orgCreatedIdx: index('idx_csv_imports_org_created').on(t.orgId, t.createdAt),
  orgStatusIdx:  index('idx_csv_imports_org_status').on(t.orgId, t.status),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Domain table 35: import_rows
// ─────────────────────────────────────────────────────────────────────────────

export const importRows = pgTable('import_rows', {
  id:             uuid('id').primaryKey().defaultRandom(),
  importId:       uuid('import_id').notNull().references(() => csvImports.id, { onDelete: 'cascade' }),
  rowNumber:      integer('row_number').notNull(),
  rawData:        jsonb('raw_data').notNull(),
  normalizedData: jsonb('normalized_data'),
  status:         text('status').notNull(),  // 'ok'|'warning'|'error'
  errorDetail:    text('error_detail'),
  createdAt:      timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  importRowIdx:  index('idx_import_rows_import_id').on(t.importId, t.rowNumber),
  statusIdx:     index('idx_import_rows_status').on(t.importId, t.status),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Domain table 36: account_mappings
// ─────────────────────────────────────────────────────────────────────────────

export const accountMappings = pgTable('account_mappings', {
  id:               uuid('id').primaryKey().defaultRandom(),
  orgId:            uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  externalAccount:  text('external_account').notNull(),
  internalCategory: text('internal_category'),
  isIncome:         boolean('is_income').notNull().default(false),
  affectsNetProfit: boolean('affects_net_profit').notNull().default(true),
  createdBy:        uuid('created_by').references(() => profiles.id, { onDelete: 'set null' }),
}, (t) => ({
  orgIdx:   index('idx_account_mappings_org').on(t.orgId),
  extUniq:  uniqueIndex('account_mappings_org_account_uq').on(t.orgId, t.externalAccount),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Domain table 37: property_mappings
// ─────────────────────────────────────────────────────────────────────────────

export const propertyMappings = pgTable('property_mappings', {
  id:                 uuid('id').primaryKey().defaultRandom(),
  orgId:              uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  externalName:       text('external_name').notNull(),
  internalPropertyId: uuid('internal_property_id').references(() => properties.id, { onDelete: 'set null' }),
  lastMatchedAt:      timestamp('last_matched_at', { withTimezone: true }),
  createdBy:          uuid('created_by').references(() => profiles.id, { onDelete: 'set null' }),
}, (t) => ({
  orgIdx:  index('idx_property_mappings_org').on(t.orgId),
  nameUniq: uniqueIndex('property_mappings_org_name_uq').on(t.orgId, t.externalName),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Domain table 38: phantom_rooms
// ─────────────────────────────────────────────────────────────────────────────

export const phantomRooms = pgTable('phantom_rooms', {
  id:           uuid('id').primaryKey().defaultRandom(),
  orgId:        uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  rawRoomLabel: text('raw_room_label').notNull(),
  matchedUnitId: uuid('matched_unit_id').references(() => units.id, { onDelete: 'set null' }),
  resolution:   text('resolution').notNull().default('pending'),  // 'pending'|'mapped'|'ignored'
  resolvedBy:   uuid('resolved_by').references(() => profiles.id, { onDelete: 'set null' }),
  resolvedAt:   timestamp('resolved_at', { withTimezone: true }),
  createdAt:    timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  orgResolutionIdx: index('idx_phantom_rooms_org_resolution').on(t.orgId, t.resolution),
  labelUniq:        uniqueIndex('phantom_rooms_org_label_uq').on(t.orgId, t.rawRoomLabel),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Domain table 39: ai_token_budget
// ─────────────────────────────────────────────────────────────────────────────

export const aiTokenBudget = pgTable('ai_token_budget', {
  id:         uuid('id').primaryKey().defaultRandom(),
  orgId:      uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  day:        date('day').notNull(),
  tokensUsed: integer('tokens_used').notNull().default(0),
  costUsd:    numeric('cost_usd', { precision: 10, scale: 4 }).notNull().default('0'),
  updatedAt:  timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  orgDayUniq: uniqueIndex('idx_ai_token_budget_org_day').on(t.orgId, t.day),
  orgIdx:     index('idx_ai_token_budget_org').on(t.orgId, t.day),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Domain table 40: unit_images
// ─────────────────────────────────────────────────────────────────────────────

export const unitImages = pgTable('unit_images', {
  id:          uuid('id').primaryKey().defaultRandom(),
  unitId:      uuid('unit_id').notNull().references(() => units.id, { onDelete: 'cascade' }),
  orgId:       uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  storagePath: text('storage_path').notNull(),
  filename:    text('filename').notNull(),
  mimeType:    text('mime_type').notNull(),
  sizeBytes:   integer('size_bytes').notNull(),
  width:       integer('width'),
  height:      integer('height'),
  caption:     text('caption'),
  sortOrder:   integer('sort_order').notNull().default(0),
  isCover:     boolean('is_cover').notNull().default(false),
  uploadedBy:  uuid('uploaded_by').references(() => profiles.id),
  createdAt:   timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  unitSortIdx: index('idx_unit_images_unit').on(t.unitId, t.sortOrder),
  orgIdx:      index('idx_unit_images_org').on(t.orgId),
  coverUniq:   uniqueIndex('unit_images_cover_idx').on(t.unitId).where(sql`is_cover = true`),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Domain table 41: service_payments
// ─────────────────────────────────────────────────────────────────────────────

export const servicePayments = pgTable('service_payments', {
  id:                 uuid('id').primaryKey().defaultRandom(),
  orgId:              uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  propertyId:         uuid('property_id').references(() => properties.id, { onDelete: 'set null' }),
  airtableExternalId: text('airtable_external_id'),
  airtableSyncedAt:   timestamp('airtable_synced_at', { withTimezone: true }),
  serviceType:        text('service_type').notNull(),  // 'agua'|'internet'|'gas'|'luz'|'otro'
  supplyNumber:       text('supply_number'),
  tope:               numeric('tope'),
  monthlyData:        jsonb('monthly_data'),
  createdAt:          timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt:          timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (t) => ({
  airtableUniq: uniqueIndex('service_payments_org_airtable_uniq').on(t.orgId, t.airtableExternalId),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Domain table 42: tenant_invitations
// ─────────────────────────────────────────────────────────────────────────────

export const tenantInvitations = pgTable('tenant_invitations', {
  id:         uuid('id').primaryKey().defaultRandom(),
  orgId:      uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  tenantId:   uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  email:      text('email').notNull(),
  tokenHash:  text('token_hash').notNull(),
  invitedBy:  uuid('invited_by').references(() => profiles.id, { onDelete: 'set null' }),
  status:     text('status').notNull().default('pending'),  // 'pending'|'accepted'|'expired'|'revoked'
  expiresAt:  timestamp('expires_at', { withTimezone: true }).notNull(),
  acceptedAt: timestamp('accepted_at', { withTimezone: true }),
  createdAt:  timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  tokenUniq:  uniqueIndex('tenant_invitations_token_hash_uidx').on(t.tokenHash),
  tenantIdx:  index('tenant_invitations_tenant_idx').on(t.tenantId),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Domain table 43: import_logs (moved earlier, defined above at table 9)
// Domain table 44: property_weekly_summaries
// ─────────────────────────────────────────────────────────────────────────────

export const propertyWeeklySummaries = pgTable('property_weekly_summaries', {
  id:         uuid('id').primaryKey().defaultRandom(),
  orgId:      uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  propertyId: uuid('property_id').notNull().references(() => properties.id, { onDelete: 'cascade' }),
  isoWeek:    text('iso_week').notNull(),  // e.g. '2026-W22'
  body:       text('body').notNull(),
  sentAt:     timestamp('sent_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  propertyWeekUniq: uniqueIndex('property_weekly_summaries_property_week_uq').on(t.propertyId, t.isoWeek),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Domain table 45: tenant_tasks
// ─────────────────────────────────────────────────────────────────────────────

export const tenantTasks = pgTable('tenant_tasks', {
  id:             uuid('id').primaryKey().defaultRandom(),
  orgId:          uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  tenantId:       uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  createdBy:      uuid('created_by').notNull().references(() => profiles.id, { onDelete: 'restrict' }),
  taskType:       text('task_type').notNull(),
  title:          text('title').notNull(),
  description:    text('description'),
  dueAt:          timestamp('due_at', { withTimezone: true }).notNull(),
  reminderSentAt: timestamp('reminder_sent_at', { withTimezone: true }),
  status:         text('status').notNull().default('pending'),
  completedAt:    timestamp('completed_at', { withTimezone: true }),
  createdAt:      timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:      timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  orgStatusIdx: index('idx_tt_org_status').on(t.orgId, t.status, t.dueAt),
  tenantIdx:    index('idx_tt_tenant').on(t.tenantId, t.status),
  dueAtIdx:     index('idx_tt_due_at').on(t.dueAt),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Domain table 46: task_proofs
// ─────────────────────────────────────────────────────────────────────────────

export const taskProofs = pgTable('task_proofs', {
  id:                uuid('id').primaryKey().defaultRandom(),
  orgId:             uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  taskId:            uuid('task_id').notNull().references(() => tenantTasks.id, { onDelete: 'cascade' }),
  whatsappMessageId: uuid('whatsapp_message_id').references(() => whatsappMessages.id, { onDelete: 'set null' }),
  imagePath:         text('image_path').notNull(),
  aiVerdict:         text('ai_verdict'),     // 'valid'|'invalid'|'uncertain'
  aiConfidence:      numeric('ai_confidence', { precision: 4, scale: 3 }),
  adminDecision:     text('admin_decision'), // 'accepted'|'rejected'
  createdAt:         timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  taskIdx: index('idx_tp_task').on(t.taskId, t.createdAt),
  orgIdx:  index('idx_tp_org').on(t.orgId, t.createdAt),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Domain table 47 (last): sanctions
// Note: sanctions.linked_charge_id has a UNIQUE constraint in Supabase
// ─────────────────────────────────────────────────────────────────────────────

export const sanctions = pgTable('sanctions', {
  id:             uuid('id').primaryKey().defaultRandom(),
  orgId:          uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  tenantId:       uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  proposedBy:     uuid('proposed_by').notNull().references(() => profiles.id, { onDelete: 'restrict' }),
  kind:           text('kind').notNull(),  // 'monetary'|'warning'
  title:          text('title').notNull(),
  reason:         text('reason').notNull(),
  amount:         numeric('amount', { precision: 12, scale: 2 }),
  status:         text('status').notNull().default('proposed'),
  linkedChargeId: uuid('linked_charge_id').unique().references(() => charges.id, { onDelete: 'set null' }),
  approvedBy:     uuid('approved_by').references(() => profiles.id, { onDelete: 'set null' }),
  approvedAt:     timestamp('approved_at', { withTimezone: true }),
  disputeReason:  text('dispute_reason'),
  disputedAt:     timestamp('disputed_at', { withTimezone: true }),
  resolutionNote: text('resolution_note'),
  resolvedAt:     timestamp('resolved_at', { withTimezone: true }),
  createdAt:      timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:      timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  orgStatusIdx: index('idx_sanctions_org_status').on(t.orgId, t.status, t.createdAt),
  tenantIdx:    index('idx_sanctions_tenant').on(t.tenantId, t.createdAt),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Domain table 48: charge_concepts (Conceptos — lookup for additional charge types)
// ─────────────────────────────────────────────────────────────────────────────

export const chargeConcepts = pgTable('charge_concepts', {
  id:                 uuid('id').primaryKey().defaultRandom(),
  orgId:              uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  airtableId:         text('airtable_id'),
  airtableSyncedAt:   timestamp('airtable_synced_at', { withTimezone: true }),
  code:               text('code'),
  description:        text('description').notNull(),
  tipo:               text('tipo'),
  baseAmount:         numeric('base_amount', { precision: 12, scale: 2 }),
  notes:              text('notes'),
  createdAt:          timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:          timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  orgIdx:       index('idx_charge_concepts_org').on(t.orgId),
  airtableUniq: uniqueIndex('uq_charge_concepts_airtable').on(t.orgId, t.airtableId),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Domain table 49: additional_charges (Adicionales — extra charges per contract/month)
// ─────────────────────────────────────────────────────────────────────────────

export const additionalCharges = pgTable('additional_charges', {
  id:               uuid('id').primaryKey().defaultRandom(),
  orgId:            uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  airtableId:       text('airtable_id'),
  airtableSyncedAt: timestamp('airtable_synced_at', { withTimezone: true }),
  contractId:       uuid('contract_id').references(() => contracts.id, { onDelete: 'set null' }),
  conceptId:        uuid('concept_id').references(() => chargeConcepts.id, { onDelete: 'set null' }),
  mes:              text('mes'),
  anio:             integer('anio'),
  amount:           numeric('amount', { precision: 12, scale: 2 }).notNull(),
  description:      text('description'),
  numero:           integer('numero'),
  createdAt:        timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:        timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  orgIdx:       index('idx_additional_charges_org').on(t.orgId),
  contractIdx:  index('idx_additional_charges_contract').on(t.contractId),
  airtableUniq: uniqueIndex('uq_additional_charges_airtable').on(t.orgId, t.airtableId),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Domain table 50: account_statements (EECC — monthly billing statements)
// ─────────────────────────────────────────────────────────────────────────────

export const accountStatements = pgTable('account_statements', {
  id:                    uuid('id').primaryKey().defaultRandom(),
  orgId:                 uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  airtableId:            text('airtable_id'),
  airtableSyncedAt:      timestamp('airtable_synced_at', { withTimezone: true }),
  contractId:            uuid('contract_id').references(() => contracts.id, { onDelete: 'set null' }),
  eeccCode:              text('eecc_code'),
  mes:                   text('mes'),
  anio:                  integer('anio'),
  issueDate:             date('issue_date'),
  dueDate:               date('due_date'),
  rentAmount:            numeric('rent_amount', { precision: 12, scale: 2 }),
  additionalSubtotal:    numeric('additional_subtotal', { precision: 12, scale: 2 }),
  previousRentBalance:   numeric('previous_rent_balance', { precision: 12, scale: 2 }),
  previousAddlBalance:   numeric('previous_addl_balance', { precision: 12, scale: 2 }),
  totalDue:              numeric('total_due', { precision: 12, scale: 2 }),
  sendStatus:            text('send_status'),
  sendDate:              date('send_date'),
  pdfUrl:                text('pdf_url'),
  whatsappMessageId:     text('whatsapp_message_id'),
  sendError:             text('send_error'),
  createdAt:             timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:             timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  orgIdx:       index('idx_account_statements_org').on(t.orgId),
  contractIdx:  index('idx_account_statements_contract').on(t.contractId),
  dateIdx:      index('idx_account_statements_date').on(t.orgId, t.anio, t.mes),
  airtableUniq: uniqueIndex('uq_account_statements_airtable').on(t.orgId, t.airtableId),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Domain table 51: tax_receipts (Impuestos / Comprobantes — invoices per contract)
// ─────────────────────────────────────────────────────────────────────────────

export const taxReceipts = pgTable('tax_receipts', {
  id:               uuid('id').primaryKey().defaultRandom(),
  orgId:            uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  airtableId:       text('airtable_id'),
  airtableSyncedAt: timestamp('airtable_synced_at', { withTimezone: true }),
  contractId:       uuid('contract_id').references(() => contracts.id, { onDelete: 'set null' }),
  receiptCode:      text('receipt_code'),
  tipo:             text('tipo'),
  numero:           text('numero'),
  mes:              text('mes'),
  anio:             integer('anio'),
  issueDate:        date('issue_date'),
  baseAmount:       numeric('base_amount', { precision: 12, scale: 2 }),
  includesIgv:      boolean('includes_igv').default(false),
  igvAmount:        numeric('igv_amount', { precision: 12, scale: 2 }),
  totalAmount:      numeric('total_amount', { precision: 12, scale: 2 }),
  status:           text('status'),
  fileUrl:          text('file_url'),
  createdAt:        timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:        timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  orgIdx:       index('idx_tax_receipts_org').on(t.orgId),
  contractIdx:  index('idx_tax_receipts_contract').on(t.contractId),
  airtableUniq: uniqueIndex('uq_tax_receipts_airtable').on(t.orgId, t.airtableId),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Domain table 52: tenant_feedback (Feedback — satisfaction surveys per tenant)
// ─────────────────────────────────────────────────────────────────────────────

export const tenantFeedback = pgTable('tenant_feedback', {
  id:               uuid('id').primaryKey().defaultRandom(),
  orgId:            uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  airtableId:       text('airtable_id'),
  airtableSyncedAt: timestamp('airtable_synced_at', { withTimezone: true }),
  tenantId:         uuid('tenant_id').references(() => tenants.id, { onDelete: 'set null' }),
  fecha:            date('fecha'),
  cleaningScore:    integer('cleaning_score'),
  coexistenceScore: integer('coexistence_score'),
  attentionScore:   integer('attention_score'),
  securityScore:    integer('security_score'),
  valueScore:       integer('value_score'),
  wouldRecommend:   boolean('would_recommend'),
  comment:          text('comment'),
  worstExperience:  text('worst_experience'),
  createdAt:        timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:        timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  orgIdx:       index('idx_tenant_feedback_org').on(t.orgId),
  tenantIdx:    index('idx_tenant_feedback_tenant').on(t.tenantId),
  airtableUniq: uniqueIndex('uq_tenant_feedback_airtable').on(t.orgId, t.airtableId),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Relations (used by Drizzle query builder — optional but enables join inference)
// ─────────────────────────────────────────────────────────────────────────────

export const organizationsRelations = relations(organizations, ({ many }) => ({
  profiles:   many(profiles),
  properties: many(properties),
  tenants:    many(tenants),
  payments:   many(payments),
}));

export const profilesRelations = relations(profiles, ({ one }) => ({
  organization: one(organizations, { fields: [profiles.orgId], references: [organizations.id] }),
  user:         one(users, { fields: [profiles.userId], references: [users.id] }),
}));

export const usersRelations = relations(users, ({ one, many }) => ({
  profile:  one(profiles, { fields: [users.id], references: [profiles.userId] }),
  accounts: many(accounts),
  sessions: many(sessions),
}));
