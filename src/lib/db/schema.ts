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
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';
// import type only — avoids a circular runtime import (types.ts has no runtime deps on schema.ts).
import type { AgentAttribution } from '@/lib/agent/types';

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
  // Agent qualification fields (Phase 1). `status` above is left untouched —
  // dashboard/leads still reads it; `stage` is the agent's richer pipeline.
  operationType:      text('operation_type'),      // 'rent'|'buy'|'owner_sell'|'owner_rent'
  pipeline:           text('pipeline').notNull().default('demand'), // 'demand'|'supply'
  budgetMin:          numeric('budget_min', { precision: 12, scale: 2 }),
  budgetMax:          numeric('budget_max', { precision: 12, scale: 2 }),
  currency:           text('currency').notNull().default('PEN'),
  zones:              jsonb('zones').notNull().default([]).$type<string[]>(),
  bedroomsMin:        integer('bedrooms_min'),
  moveInDate:         date('move_in_date'),
  timeline:           text('timeline'), // 'immediate'|'1_3_months'|'3_6_months'|'flexible'
  pets:               boolean('pets'),
  score:              integer('score').notNull().default(0),
  intentTag:          text('intent_tag'), // 'high_intent'|'under_analysis'|'qualified'|'cold'
  assignedProfileId:  uuid('assigned_profile_id').references(() => profiles.id, { onDelete: 'set null' }),
  stage:              text('stage').notNull().default('new'),
  // Phase 6 (0008): free-form per-org stage key (CHECK crm_leads_stage_format
  // in SQL — matches /^[a-z][a-z0-9_]{1,39}$/), no longer a fixed enum. See
  // src/lib/leads/types.ts SYSTEM_STAGES for the seeded defaults per pipeline.
  nextFollowupAt:     timestamp('next_followup_at', { withTimezone: true }),
  doNotContact:       boolean('do_not_contact').notNull().default(false),
  sourceChannel:      text('source_channel'), // 'whatsapp'|'web'|'voice'|'manual'
  sourceRef:          text('source_ref'),
  sourceMeta:         jsonb('source_meta').notNull().default({}).$type<Record<string, unknown>>(),
  // Phase 6 (0008): routing/pipeline bookkeeping.
  assignedAt:         timestamp('assigned_at', { withTimezone: true }),
  stageChangedAt:     timestamp('stage_changed_at', { withTimezone: true }),
  followupState:      text('followup_state').notNull().default('idle'), // 'idle'|'active'|'stopped'|'completed'
  followupStopReason: text('followup_stop_reason'),
  lastListingAlertAt: timestamp('last_listing_alert_at', { withTimezone: true }),
  createdAt:        timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:        timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  orgIdx:       index('idx_crm_leads_org').on(t.orgId),
  orgStatusIdx: index('idx_crm_leads_org_status').on(t.orgId, t.status),
  orgStageIdx:      index('idx_crm_leads_org_stage').on(t.orgId, t.stage),
  orgFollowupIdx:   index('idx_crm_leads_org_followup').on(t.orgId, t.nextFollowupAt),
  orgPipelineStageIdx: index('idx_crm_leads_org_pipeline_stage').on(t.orgId, t.pipeline, t.stage),
  orgAssignedIdx:      index('idx_crm_leads_org_assigned').on(t.orgId, t.assignedProfileId),
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
  // Agent Phase 2: per-message claim/debounce + sender attribution for the inbox.
  agentStatus:       text('agent_status'),           // null (tenant/disabled) | 'pending'|'processing'|'processed'|'skipped'
  senderKind:        text('sender_kind'),             // 'contact'|'agent'|'human'|'system'
  sentByProfileId:   uuid('sent_by_profile_id').references(() => profiles.id, { onDelete: 'set null' }),
  // Item 4: when this row was claimed ('pending' → 'processing') — lets the
  // sweeper tell a crashed turn (stuck 'processing') apart from one still in
  // flight, so it can resurrect the former back to 'pending'.
  agentClaimedAt:    timestamp('agent_claimed_at', { withTimezone: true }),
  createdAt:         timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  convIdx:       index('idx_wa_msg_conv').on(t.conversationId, t.createdAt),
  orgStatusIdx:  index('idx_wa_msg_org_status').on(t.orgId, t.status, t.createdAt),
  // Plain unique index, not a deferrable constraint (see migration 0005) — Postgres
  // requires a non-deferrable arbiter for insertMessage()'s onConflictDoNothing.
  providerUniq:  uniqueIndex('whatsapp_messages_provider_id_per_org').on(t.orgId, t.providerMessageId),
  agentPendingIdx: index('idx_wa_msg_agent_pending').on(t.conversationId, t.createdAt)
    .where(sql`agent_status IN ('pending','processing')`),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Domain table: org_channels — routes an inbound channel identifier (WhatsApp
// phone_number_id, widget public key, voice number) to an organization.
// ─────────────────────────────────────────────────────────────────────────────

export const orgChannels = pgTable('org_channels', {
  id:         uuid('id').primaryKey().defaultRandom(),
  orgId:      uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  channel:    text('channel').notNull(),      // 'whatsapp' | 'web' | 'voice'
  externalId: text('external_id').notNull(),  // phone_number_id | widget public key | voice number
  config:     jsonb('config').notNull().default({}),
  createdAt:  timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:  timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  channelExternalUniq: uniqueIndex('org_channels_channel_external_id').on(t.channel, t.externalId),
  orgIdx:              index('idx_org_channels_org').on(t.orgId),
  // Agent Phase 7: resolveWebChannel()/getOrgWebChannel() assume exactly one
  // 'web' row per org.
  oneWebPerOrgUniq:    uniqueIndex('org_channels_one_web_per_org').on(t.orgId).where(sql`channel = 'web'`),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Domain table: agent_jobs — durable queue for the real-estate agent's async
// work (reminders, follow-ups, calendar sync, outbound calls). Claimed with
// FOR UPDATE SKIP LOCKED by the agent-dispatch drain (src/lib/agent/jobs.ts).
// ─────────────────────────────────────────────────────────────────────────────

export const agentJobs = pgTable('agent_jobs', {
  id:          uuid('id').primaryKey().defaultRandom(),
  orgId:       uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  kind:        text('kind').notNull(),
  runAt:       timestamp('run_at', { withTimezone: true }).notNull().defaultNow(),
  payload:     jsonb('payload').notNull().default({}),
  status:      text('status').notNull().default('pending'), // 'pending'|'processing'|'done'|'failed'
  attempts:    integer('attempts').notNull().default(0),
  lastError:   text('last_error'),
  lockedUntil: timestamp('locked_until', { withTimezone: true }),
  createdAt:   timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:   timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  dueIdx: index('idx_agent_jobs_due').on(t.status, t.runAt),
  orgIdx: index('idx_agent_jobs_org').on(t.orgId),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Domain table: agent_configs — one row per org. Seeded with defaults by the
// app on first read (src/lib/agent/config.ts), not by inserting a row here.
// ─────────────────────────────────────────────────────────────────────────────

export const agentConfigs = pgTable('agent_configs', {
  id:                    uuid('id').primaryKey().defaultRandom(),
  orgId:                 uuid('org_id').notNull().unique().references(() => organizations.id, { onDelete: 'cascade' }),
  persona:               text('persona').notNull().default('Asistente inmobiliario'),
  tone:                  text('tone').notNull().default('profesional'), // 'profesional'|'cercano'|'formal'
  rules:                 text('rules'),
  prohibited:            text('prohibited'),
  faq:                   jsonb('faq').notNull().default([]),
  businessHours:         jsonb('business_hours').notNull().default({}),
  timezone:              text('timezone').notNull().default('America/Lima'),
  qualificationFields:   jsonb('qualification_fields').notNull()
    .default(['operation_type', 'zones', 'budget_max', 'bedrooms_min', 'timeline']),
  followupPolicy:        jsonb('followup_policy').notNull().default({}),
  routingMode:           text('routing_mode').notNull().default('round_robin'), // 'round_robin'|'weighted'|'manual'
  dailyTokenBudget:      integer('daily_token_budget').notNull().default(50_000),
  widgetAllowedOrigins:  jsonb('widget_allowed_origins').notNull().default([]),
  channelsEnabled:       jsonb('channels_enabled').notNull()
    .default({ whatsapp: false, web: false, voice: false }),
  shadowMode:            boolean('shadow_mode').notNull().default(false),
  maxAgentTurns:         integer('max_agent_turns').default(30),
  // Agent Phase 7: public catalogue pages (src/app/p/**) are opt-in per org —
  // syncListingsFromUnits() inserts published=true rows, so without this gate
  // turning on the widget would also expose every synced unit's page.
  publicPagesEnabled:    boolean('public_pages_enabled').notNull().default(false),
  // Agent Phase 8: voice AI (Vapi) config — see src/lib/agent/config-schema.ts's VoiceConfig.
  voiceConfig:           jsonb('voice_config').notNull().default({}),
  // Agent Phase 9: settings/metrics — the two remaining per-org limits.
  maxActiveVisitsPerPhone: integer('max_active_visits_per_phone').notNull().default(2),
  maxListingPhotos:      integer('max_listing_photos').notNull().default(5),
  createdAt:             timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:             timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ─────────────────────────────────────────────────────────────────────────────
// Domain table: agent_sessions — one conversational thread per (org, channel,
// external_id). Links to whatsapp_conversations so the inbox and the agent
// share one history instead of drifting apart.
// ─────────────────────────────────────────────────────────────────────────────

export const agentSessions = pgTable('agent_sessions', {
  id:                     uuid('id').primaryKey().defaultRandom(),
  orgId:                  uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  channel:                text('channel').notNull(), // 'whatsapp'|'web'|'voice'
  externalId:             text('external_id').notNull(),
  leadId:                 uuid('lead_id').references(() => crmLeads.id, { onDelete: 'set null' }),
  whatsappConversationId: uuid('whatsapp_conversation_id').references(() => whatsappConversations.id, { onDelete: 'set null' }),
  mode:                   text('mode').notNull().default('ai'), // 'ai'|'human'|'paused'
  summary:                text('summary'),
  windowExpiresAt:        timestamp('window_expires_at', { withTimezone: true }),
  processingLockedUntil:  timestamp('processing_locked_until', { withTimezone: true }),
  // Agent Phase 2: turn cap, language, attribution and handoff bookkeeping.
  agentTurnCount:         integer('agent_turn_count').notNull().default(0),
  language:               text('language'), // 'es'|'en'|'pt'
  attribution:            jsonb('attribution').$type<AgentAttribution | null>(),
  handoffReason:          text('handoff_reason'), // 'tool'|'budget'|'turn_cap'|'manual'
  lastInboundAt:          timestamp('last_inbound_at', { withTimezone: true }),
  lastAgentTurnAt:        timestamp('last_agent_turn_at', { withTimezone: true }),
  createdAt:              timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:              timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  channelExternalUniq: uniqueIndex('uq_agent_sessions_channel_external').on(t.orgId, t.channel, t.externalId),
  orgIdx:              index('idx_agent_sessions_org').on(t.orgId),
  leadIdx:             index('idx_agent_sessions_lead').on(t.leadId),
  orgInboundIdx:       index('idx_agent_sessions_org_inbound').on(t.orgId, t.lastInboundAt),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Domain table: agent_messages — full Anthropic content-block history per
// session, append-only. Separate from whatsapp_messages (the inbox's source
// of truth) so LLM context (tool_use/tool_result blocks) never round-trips
// through it.
// ─────────────────────────────────────────────────────────────────────────────

export const agentMessages = pgTable('agent_messages', {
  id:           uuid('id').primaryKey().defaultRandom(),
  orgId:        uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  sessionId:    uuid('session_id').notNull().references(() => agentSessions.id, { onDelete: 'cascade' }),
  role:         text('role').notNull(), // 'user'|'assistant'
  content:      jsonb('content').notNull(),
  inputTokens:  integer('input_tokens'),
  outputTokens: integer('output_tokens'),
  costUsd:      numeric('cost_usd', { precision: 10, scale: 4 }),
  // OVERRIDE (Phase 2, item A): null|'sent' rows count toward LLM history;
  // 'shadow_pending' (unreviewed shadow-mode draft) and 'shadow_discarded'
  // (rejected draft) are filtered out by getSessionHistory(). See
  // handoffs/phase2-blueprint.md item A "Override" note.
  sendStatus:   text('send_status'),
  createdAt:    timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  sessionIdx: index('idx_agent_messages_session').on(t.sessionId, t.createdAt),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Domain table: listings — unified rent + sale inventory. Owns price and
// marketing copy; the unit-derivation job (src/lib/agent/listings.ts) only
// inserts missing rows and updates availability, never price or text.
// ─────────────────────────────────────────────────────────────────────────────

export const listings = pgTable('listings', {
  id:              uuid('id').primaryKey().defaultRandom(),
  orgId:           uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  unitId:          uuid('unit_id').references(() => units.id, { onDelete: 'set null' }),
  propertyId:      uuid('property_id').references(() => properties.id, { onDelete: 'set null' }),
  operation:       text('operation').notNull(), // 'rent'|'sale'
  price:           numeric('price', { precision: 14, scale: 2 }),
  currency:        text('currency').notNull().default('PEN'),
  status:          text('status').notNull().default('available'), // 'available'|'reserved'|'closed'
  statusOverride:  boolean('status_override').notNull().default(false),
  title:           text('title'),
  description:     text('description'),
  zone:            text('zone'),
  bedrooms:        integer('bedrooms'),
  bathrooms:       integer('bathrooms'),
  areaM2:          numeric('area_m2'),
  parking:         boolean('parking').notNull().default(false),
  maintenanceFee:  numeric('maintenance_fee', { precision: 12, scale: 2 }),
  petsAllowed:     boolean('pets_allowed'),
  publicSlug:      text('public_slug'),
  published:       boolean('published').notNull().default(false),
  // Phase 6 (0008): set by the trg_listings_published_at trigger + CHECK,
  // only in SQL — never write this column from app code.
  publishedAt:     timestamp('published_at', { withTimezone: true }),
  refCode:         text('ref_code'),
  createdAt:       timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:       timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  orgIdx:          index('idx_listings_org').on(t.orgId),
  orgPublishedIdx: index('idx_listings_org_published').on(t.orgId, t.published, t.status),
  unitUniq:        uniqueIndex('listings_org_unit_uniq').on(t.orgId, t.unitId).where(sql`unit_id IS NOT NULL`),
  slugUniq:        uniqueIndex('listings_org_slug_uniq').on(t.orgId, t.publicSlug).where(sql`public_slug IS NOT NULL`),
  refCodeUniq:     uniqueIndex('listings_org_ref_code_uniq').on(t.orgId, t.refCode).where(sql`ref_code IS NOT NULL`),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Domain table: listing_images — for listings without a unit (standalone sale
// listings). Unit-backed listings reuse unit_images instead.
// ─────────────────────────────────────────────────────────────────────────────

export const listingImages = pgTable('listing_images', {
  id:          uuid('id').primaryKey().defaultRandom(),
  orgId:       uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  listingId:   uuid('listing_id').notNull().references(() => listings.id, { onDelete: 'cascade' }),
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
  listingSortIdx: index('idx_listing_images_listing').on(t.listingId, t.sortOrder),
  orgIdx:         index('idx_listing_images_org').on(t.orgId),
  coverUniq:      uniqueIndex('listing_images_cover_idx').on(t.listingId).where(sql`is_cover = true`),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Domain table: agent_suggestions — shadow mode's review queue. The turn runs
// for real (tools write, history persists) but the reply waits here for a
// human to approve (optionally edited) or discard before it reaches WhatsApp.
// ─────────────────────────────────────────────────────────────────────────────

export const agentSuggestions = pgTable('agent_suggestions', {
  id:                     uuid('id').primaryKey().defaultRandom(),
  orgId:                  uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  sessionId:              uuid('session_id').notNull().references(() => agentSessions.id, { onDelete: 'cascade' }),
  whatsappConversationId: uuid('whatsapp_conversation_id').references(() => whatsappConversations.id, { onDelete: 'set null' }),
  // OVERRIDE: the assistant turn (agent_messages row) this suggestion drafted.
  // Flips to send_status='sent' (approved, possibly with edited content) or
  // 'shadow_discarded' when decided — see getSessionHistory().
  agentMessageId:         uuid('agent_message_id').references(() => agentMessages.id, { onDelete: 'set null' }),
  body:                   text('body').notNull(),
  status:                 text('status').notNull().default('pending'), // 'pending'|'sending'|'sent'|'discarded'|'superseded'
  decidedBy:              uuid('decided_by').references(() => profiles.id, { onDelete: 'set null' }),
  decidedAt:              timestamp('decided_at', { withTimezone: true }),
  sentMessageId:          uuid('sent_message_id').references(() => whatsappMessages.id, { onDelete: 'set null' }),
  createdAt:              timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  sessionIdx:  index('idx_agent_suggestions_session').on(t.sessionId, t.createdAt),
  onePending:  uniqueIndex('agent_suggestions_one_pending').on(t.sessionId).where(sql`status = 'pending'`),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Domain table: agent_events — inbox timeline (handoffs, mode changes,
// suggestions, attribution, window-closed, turn errors). `kind` is free TEXT
// with no CHECK so later phases (e.g. Phase 3's visit_* kinds) don't need a
// migration.
// ─────────────────────────────────────────────────────────────────────────────

export const agentEvents = pgTable('agent_events', {
  id:              uuid('id').primaryKey().defaultRandom(),
  orgId:           uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  sessionId:       uuid('session_id').notNull().references(() => agentSessions.id, { onDelete: 'cascade' }),
  kind:            text('kind').notNull(),
  data:            jsonb('data').notNull().default({}),
  actorProfileId:  uuid('actor_profile_id').references(() => profiles.id, { onDelete: 'set null' }),
  createdAt:       timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  sessionIdx: index('idx_agent_events_session').on(t.sessionId, t.createdAt),
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
// Domain table 53: owners (Propietarios — property owners synced from Airtable)
// ─────────────────────────────────────────────────────────────────────────────

export const owners = pgTable('owners', {
  id:                 uuid('id').primaryKey().defaultRandom(),
  orgId:              uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  airtableExternalId: text('airtable_external_id'),
  airtableSyncedAt:   timestamp('airtable_synced_at', { withTimezone: true }),
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
  createdAt:          timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:          timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  orgIdx:       index('idx_owners_org').on(t.orgId),
  airtableUniq: uniqueIndex('owners_org_airtable_uniq').on(t.orgId, t.airtableExternalId),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Domain table 54: deposit_accounts (Cuentas de deposito — bank accounts for deposits)
// ─────────────────────────────────────────────────────────────────────────────

export const depositAccounts = pgTable('deposit_accounts', {
  id:                 uuid('id').primaryKey().defaultRandom(),
  orgId:              uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  airtableExternalId: text('airtable_external_id'),
  airtableSyncedAt:   timestamp('airtable_synced_at', { withTimezone: true }),
  name:               text('name'),
  banco:              text('banco'),
  tipoCuenta:         text('tipo_cuenta'),
  moneda:             text('moneda'),
  numeroCuenta:       text('numero_cuenta'),
  cci:                text('cci'),
  createdAt:          timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:          timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  orgIdx:       index('idx_deposit_accounts_org').on(t.orgId),
  airtableUniq: uniqueIndex('deposit_accounts_org_airtable_uniq').on(t.orgId, t.airtableExternalId),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Domain table 55: trash_schedules (Turnos Basura — assigned trash duty schedules)
// ─────────────────────────────────────────────────────────────────────────────

export const trashSchedules = pgTable('trash_schedules', {
  id:                 uuid('id').primaryKey().defaultRandom(),
  orgId:              uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  airtableExternalId: text('airtable_external_id'),
  airtableSyncedAt:   timestamp('airtable_synced_at', { withTimezone: true }),
  name:               text('name'),
  tenantId:           uuid('tenant_id').references(() => tenants.id, { onDelete: 'set null' }),
  unitId:             uuid('unit_id').references(() => units.id, { onDelete: 'set null' }),
  zona:               text('zona'),
  dias:               text('dias'),
  activo:             boolean('activo').notNull().default(true),
  turnosExtra:        integer('turnos_extra'),
  createdAt:          timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:          timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  orgIdx:       index('idx_trash_schedules_org').on(t.orgId),
  airtableUniq: uniqueIndex('trash_schedules_org_airtable_uniq').on(t.orgId, t.airtableExternalId),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Domain table 56: trash_compliance (Cumplimiento Basura — trash duty compliance records)
// ─────────────────────────────────────────────────────────────────────────────

export const trashCompliance = pgTable('trash_compliance', {
  id:                 uuid('id').primaryKey().defaultRandom(),
  orgId:              uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  airtableExternalId: text('airtable_external_id'),
  airtableSyncedAt:   timestamp('airtable_synced_at', { withTimezone: true }),
  name:               text('name'),
  trashScheduleId:    uuid('trash_schedule_id').references(() => trashSchedules.id, { onDelete: 'set null' }),
  tenantId:           uuid('tenant_id').references(() => tenants.id, { onDelete: 'set null' }),
  fecha:              date('fecha'),
  estado:             text('estado'),
  fotoUrl:            text('foto_url'),
  horaConfirmacion:   timestamp('hora_confirmacion', { withTimezone: true }),
  hashImagen:         text('hash_imagen'),
  createdAt:          timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:          timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  orgIdx:       index('idx_trash_compliance_org').on(t.orgId),
  airtableUniq: uniqueIndex('trash_compliance_org_airtable_uniq').on(t.orgId, t.airtableExternalId),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Domain table 57: absences (Ausencias — tenant absence records)
// ─────────────────────────────────────────────────────────────────────────────

export const absences = pgTable('absences', {
  id:                 uuid('id').primaryKey().defaultRandom(),
  orgId:              uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  airtableExternalId: text('airtable_external_id'),
  airtableSyncedAt:   timestamp('airtable_synced_at', { withTimezone: true }),
  name:               text('name'),
  tenantId:           uuid('tenant_id').references(() => tenants.id, { onDelete: 'set null' }),
  fechaInicio:        date('fecha_inicio'),
  fechaFin:           date('fecha_fin'),
  estado:             text('estado'),
  registrado:         timestamp('registrado', { withTimezone: true }),
  motivo:             text('motivo'),
  createdAt:          timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:          timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  orgIdx:       index('idx_absences_org').on(t.orgId),
  airtableUniq: uniqueIndex('absences_org_airtable_uniq').on(t.orgId, t.airtableExternalId),
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

// ─────────────────────────────────────────────────────────────────────────────
// Agent Phase 3-4: internal agenda, visit booking, reminders, post-visit.
// See src/lib/db/migrations/0006_agent_visits.sql (applied by hand).
// ─────────────────────────────────────────────────────────────────────────────

export const agentAdvisorSettings = pgTable('agent_advisor_settings', {
  id:               uuid('id').primaryKey().defaultRandom(),
  orgId:            uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  profileId:        uuid('profile_id').notNull().references(() => profiles.id, { onDelete: 'cascade' }),
  acceptsVisits:    boolean('accepts_visits').notNull().default(true),
  visitMinutes:     integer('visit_minutes').notNull().default(45),
  bufferMinutes:    integer('buffer_minutes').notNull().default(15),
  minNoticeMinutes: integer('min_notice_minutes').notNull().default(120),
  daysAhead:        integer('days_ahead').notNull().default(14),
  slotStepMinutes:  integer('slot_step_minutes').notNull().default(30),
  createdAt:        timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:        timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  orgProfileUniq: uniqueIndex('agent_advisor_settings_org_profile_uidx').on(t.orgId, t.profileId),
}));

export const agentAvailability = pgTable('agent_availability', {
  id:          uuid('id').primaryKey().defaultRandom(),
  orgId:       uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  profileId:   uuid('profile_id').notNull().references(() => profiles.id, { onDelete: 'cascade' }),
  weekday:     integer('weekday').notNull(),      // 0 = Sunday, same as Date#getDay — SMALLINT in SQL
  startMinute: integer('start_minute').notNull(), // minutes since local midnight
  endMinute:   integer('end_minute').notNull(),
  createdAt:   timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  orgProfileIdx: index('idx_agent_availability_org_profile').on(t.orgId, t.profileId),
}));

export const agentAvailabilityExceptions = pgTable('agent_availability_exceptions', {
  id:                  uuid('id').primaryKey().defaultRandom(),
  orgId:               uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  profileId:           uuid('profile_id').notNull().references(() => profiles.id, { onDelete: 'cascade' }),
  startsAt:            timestamp('starts_at', { withTimezone: true }).notNull(),
  endsAt:              timestamp('ends_at', { withTimezone: true }).notNull(),
  kind:                text('kind').notNull(), // 'block' | 'extra'
  reason:              text('reason'),
  createdByProfileId:  uuid('created_by_profile_id').references(() => profiles.id, { onDelete: 'set null' }),
  createdAt:           timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  orgProfileStartsIdx: index('idx_agent_availability_exceptions_org_profile_starts').on(t.orgId, t.profileId, t.startsAt),
}));

// NOTE: the `property_visits_no_overlap` EXCLUDE USING gist constraint is
// declared only in 0006_agent_visits.sql — Drizzle has no EXCLUDE constraint
// builder, and this table must NEVER be pushed with `drizzle-kit push`
// (it would silently drop the constraint).
export const propertyVisits = pgTable('property_visits', {
  id:                   uuid('id').primaryKey().defaultRandom(),
  orgId:                uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  leadId:               uuid('lead_id').notNull().references(() => crmLeads.id, { onDelete: 'cascade' }),
  listingId:            uuid('listing_id').references(() => listings.id, { onDelete: 'set null' }),
  profileId:            uuid('profile_id').notNull().references(() => profiles.id, { onDelete: 'restrict' }),
  sessionId:            uuid('session_id').references(() => agentSessions.id, { onDelete: 'set null' }),
  contactPhone:         text('contact_phone'),
  startsAt:             timestamp('starts_at', { withTimezone: true }).notNull(),
  endsAt:               timestamp('ends_at', { withTimezone: true }).notNull(),
  blockedUntil:         timestamp('blocked_until', { withTimezone: true }).notNull(),
  status:               text('status').notNull().default('scheduled'),
  // 'scheduled'|'confirmed'|'completed'|'no_show'|'cancelled'|'rescheduled'
  createdBy:            text('created_by').notNull(), // 'agent'|'human'
  createdByProfileId:   uuid('created_by_profile_id').references(() => profiles.id, { onDelete: 'set null' }),
  sourceChannel:        text('source_channel').notNull(), // 'whatsapp'|'web'|'voice'|'manual'
  rescheduledFromId:    uuid('rescheduled_from_id').references((): AnyPgColumn => propertyVisits.id, { onDelete: 'set null' }),
  googleEventId:        text('google_event_id'), // Phase 5
  // Phase 5 (0007): Google Calendar sync bookkeeping.
  googleConnectionId:   uuid('google_connection_id').references((): AnyPgColumn => calendarConnections.id, { onDelete: 'set null' }),
  googleSyncStatus:     text('google_sync_status').notNull().default('none'),
  // 'none'|'pending'|'synced'|'error'|'detached'|'drift'
  googleEventEtag:      text('google_event_etag'),
  googleSyncedAt:       timestamp('google_synced_at', { withTimezone: true }),
  googleSyncError:      text('google_sync_error'),
  googleDriftStartsAt:  timestamp('google_drift_starts_at', { withTimezone: true }),
  googleDriftEndsAt:    timestamp('google_drift_ends_at', { withTimezone: true }),
  notes:                text('notes'),
  cancelReason:         text('cancel_reason'),
  feedback:             text('feedback'), // 'interested'|'not_interested'|'wants_more'
  outcomeSource:        text('outcome_source'), // 'staff'|'lead'
  confirmedAt:          timestamp('confirmed_at', { withTimezone: true }),
  cancelledAt:          timestamp('cancelled_at', { withTimezone: true }),
  completedAt:          timestamp('completed_at', { withTimezone: true }),
  reminder24hSentAt:    timestamp('reminder_24h_sent_at', { withTimezone: true }),
  reminder2hSentAt:     timestamp('reminder_2h_sent_at', { withTimezone: true }),
  advisorRemindedAt:    timestamp('advisor_reminded_at', { withTimezone: true }),
  postCheckSentAt:      timestamp('post_check_sent_at', { withTimezone: true }),
  feedbackRequestedAt:  timestamp('feedback_requested_at', { withTimezone: true }),
  reofferSentAt:        timestamp('reoffer_sent_at', { withTimezone: true }),
  createdAt:            timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:            timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  orgStartsIdx:       index('idx_property_visits_org_starts').on(t.orgId, t.startsAt),
  orgProfileStartsIdx: index('idx_property_visits_org_profile_starts').on(t.orgId, t.profileId, t.startsAt),
  leadIdx:            index('idx_property_visits_lead').on(t.leadId),
  orgPhoneStatusIdx:  index('idx_property_visits_org_phone_status').on(t.orgId, t.contactPhone, t.status),
  orgCreatedIdx:      index('idx_property_visits_org_created').on(t.orgId, t.createdAt),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Domain table: calendar_connections — Phase 5, item A. One Google Calendar
// OAuth connection per (org, advisor profile). Tokens are AES-GCM ciphertext
// (src/lib/crypto/encrypt.ts) and never plaintext at rest.
// ─────────────────────────────────────────────────────────────────────────────

export const calendarConnections = pgTable('calendar_connections', {
  id:                    uuid('id').primaryKey().defaultRandom(),
  orgId:                 uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  profileId:             uuid('profile_id').notNull().references(() => profiles.id, { onDelete: 'cascade' }),
  provider:              text('provider').notNull().default('google'), // 'google'
  googleEmail:           text('google_email').notNull(),
  calendarId:            text('calendar_id').notNull().default('primary'),
  scopes:                text('scopes').array().notNull().default([]),
  refreshTokenEnc:       text('refresh_token_enc').notNull(),
  accessTokenEnc:        text('access_token_enc'),
  accessTokenExpiresAt:  timestamp('access_token_expires_at', { withTimezone: true }),
  status:                text('status').notNull().default('active'), // 'active'|'revoked'|'error'
  lastError:             text('last_error'),
  freebusyEnabled:       boolean('freebusy_enabled').notNull().default(true),
  writeEvents:           boolean('write_events').notNull().default(true),
  syncToken:             text('sync_token'),
  syncPageToken:         text('sync_page_token'),
  lastSyncedAt:          timestamp('last_synced_at', { withTimezone: true }),
  lastFullSyncAt:        timestamp('last_full_sync_at', { withTimezone: true }),
  createdAt:             timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:             timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  orgProfileUniq: uniqueIndex('calendar_connections_org_profile_uidx').on(t.orgId, t.profileId),
  orgStatusIdx:   index('idx_calendar_connections_org_status').on(t.orgId, t.status),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Domain table: lead_pipeline_stages — Phase 6, item A. Per-org, per-pipeline
// stage list, replacing the fixed CHECK enum on crm_leads.stage. System
// stages (SYSTEM_STAGES in src/lib/leads/types.ts) are seeded lazily by
// getPipelineStages(), not by a migration.
// ─────────────────────────────────────────────────────────────────────────────

export const leadPipelineStages = pgTable('lead_pipeline_stages', {
  id:         uuid('id').primaryKey().defaultRandom(),
  orgId:      uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  pipeline:   text('pipeline').notNull(), // 'demand'|'supply'
  key:        text('key').notNull(),
  label:      text('label').notNull(),
  position:   integer('position').notNull(),
  kind:       text('kind').notNull(), // 'open'|'won'|'lost'
  color:      text('color'),
  isSystem:   boolean('is_system').notNull().default(false),
  archived:   boolean('archived').notNull().default(false),
  createdAt:  timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:  timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  orgPipelineKeyUniq: uniqueIndex('lead_pipeline_stages_org_pipeline_key_uniq').on(t.orgId, t.pipeline, t.key),
  orgPipelinePositionIdx: index('idx_lead_pipeline_stages_org_pipeline').on(t.orgId, t.pipeline, t.position),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Domain table: lead_routing_members — Phase 6, item A. Advisors eligible for
// round-robin/weighted lead assignment.
// ─────────────────────────────────────────────────────────────────────────────

export const leadRoutingMembers = pgTable('lead_routing_members', {
  id:              uuid('id').primaryKey().defaultRandom(),
  orgId:           uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  profileId:       uuid('profile_id').notNull().references(() => profiles.id, { onDelete: 'cascade' }),
  pipeline:        text('pipeline').notNull().default('both'), // 'demand'|'supply'|'both'
  weight:          integer('weight').notNull().default(1),
  active:          boolean('active').notNull().default(true),
  maxOpenLeads:    integer('max_open_leads'),
  assignedCount:   integer('assigned_count').notNull().default(0),
  lastAssignedAt:  timestamp('last_assigned_at', { withTimezone: true }),
  createdAt:       timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:       timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  orgProfileUniq: uniqueIndex('lead_routing_members_org_profile_uniq').on(t.orgId, t.profileId),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Domain table: lead_assignments — Phase 6, item A. Audit trail of every
// (re)assignment.
// ─────────────────────────────────────────────────────────────────────────────

export const leadAssignments = pgTable('lead_assignments', {
  id:                  uuid('id').primaryKey().defaultRandom(),
  orgId:               uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  leadId:              uuid('lead_id').notNull().references(() => crmLeads.id, { onDelete: 'cascade' }),
  profileId:           uuid('profile_id').references(() => profiles.id, { onDelete: 'set null' }),
  previousProfileId:   uuid('previous_profile_id').references(() => profiles.id, { onDelete: 'set null' }),
  method:              text('method'), // 'round_robin'|'weighted'|'manual'|'visit'|'reassign'
  assignedByProfileId: uuid('assigned_by_profile_id').references(() => profiles.id, { onDelete: 'set null' }),
  createdAt:           timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  orgCreatedIdx: index('idx_lead_assignments_org_created').on(t.orgId, t.createdAt),
  leadIdx:       index('idx_lead_assignments_lead').on(t.leadId),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Domain table: lead_followups — Phase 6, item A. A scheduled follow-up
// sequence, re-anchored on every new live agent reply.
// ─────────────────────────────────────────────────────────────────────────────

export const leadFollowups = pgTable('lead_followups', {
  id:                uuid('id').primaryKey().defaultRandom(),
  orgId:             uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  leadId:            uuid('lead_id').notNull().references(() => crmLeads.id, { onDelete: 'cascade' }),
  sessionId:         uuid('session_id').references(() => agentSessions.id, { onDelete: 'set null' }),
  sequenceAnchorAt:  timestamp('sequence_anchor_at', { withTimezone: true }).notNull(),
  step:              integer('step').notNull(),
  kind:              text('kind').notNull(), // 'text'|'template'
  templateName:      text('template_name'),
  scheduledFor:      timestamp('scheduled_for', { withTimezone: true }).notNull(),
  status:            text('status').notNull().default('scheduled'),
  // 'scheduled'|'sending'|'sent'|'skipped'|'cancelled'|'failed'
  stopReason:        text('stop_reason'),
  sentAt:            timestamp('sent_at', { withTimezone: true }),
  createdAt:         timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:         timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  leadAnchorStepUniq: uniqueIndex('lead_followups_lead_anchor_step_uniq').on(t.leadId, t.sequenceAnchorAt, t.step),
  orgStatusScheduledIdx: index('idx_lead_followups_org_status_scheduled').on(t.orgId, t.status, t.scheduledFor),
  leadStatusIdx:         index('idx_lead_followups_lead_status').on(t.leadId, t.status),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Domain table: lead_listing_alerts — Phase 6, item A. Claim table for
// cold-lead new-listing notifications; UNIQUE(lead_id, listing_id) is the
// send-once guarantee.
// ─────────────────────────────────────────────────────────────────────────────

export const leadListingAlerts = pgTable('lead_listing_alerts', {
  id:         uuid('id').primaryKey().defaultRandom(),
  orgId:      uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  leadId:     uuid('lead_id').notNull().references(() => crmLeads.id, { onDelete: 'cascade' }),
  listingId:  uuid('listing_id').notNull().references(() => listings.id, { onDelete: 'cascade' }),
  status:     text('status'), // 'sent'|'skipped'|'failed'
  reason:     text('reason'),
  createdAt:  timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  leadListingUniq: uniqueIndex('lead_listing_alerts_lead_listing_uniq').on(t.leadId, t.listingId),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Domain table: qa_exports — Phase 6, item A. One row per (org, ISO week) of
// handoffs/complaints/takeovers, with the generated CSV cached inline.
// ─────────────────────────────────────────────────────────────────────────────

export const qaExports = pgTable('qa_exports', {
  id:                   uuid('id').primaryKey().defaultRandom(),
  orgId:                uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  weekStart:            date('week_start').notNull(),
  periodStart:          timestamp('period_start', { withTimezone: true }),
  periodEnd:            timestamp('period_end', { withTimezone: true }),
  rowCount:             integer('row_count'),
  handoffCount:         integer('handoff_count'),
  complaintCount:       integer('complaint_count'),
  takeoverCount:        integer('takeover_count'),
  csv:                  text('csv').notNull(),
  emailedAt:            timestamp('emailed_at', { withTimezone: true }),
  emailRecipientCount:  integer('email_recipient_count').notNull().default(0),
  createdAt:            timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  orgWeekUniq: uniqueIndex('qa_exports_org_week_uniq').on(t.orgId, t.weekStart),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Agent Phase 7: web chat widget. agent_web_sessions is the widget's opaque
// session identity (the bearer token itself is never stored, only its
// sha256 — see src/lib/widget/web-session.ts); agent_web_handoff_codes are
// the WEB-XXXXXX codes that stand in for a booking or a "continue on
// WhatsApp" link until the visitor's WhatsApp message proves they own the
// phone (decision 6, handoffs/phase7-blueprint.md); agent_web_usage_daily is
// the DB-backed backstop for the in-memory per-org daily cap.
// ─────────────────────────────────────────────────────────────────────────────

export const agentWebSessions = pgTable('agent_web_sessions', {
  id:                uuid('id').primaryKey().defaultRandom(),
  orgId:             uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  tokenHash:         text('token_hash').notNull().unique(),
  agentSessionId:    uuid('agent_session_id').references(() => agentSessions.id, { onDelete: 'set null' }),
  ipHash:            text('ip_hash'),
  origin:            text('origin'),
  pageUrl:           text('page_url'),
  currentListingId:  uuid('current_listing_id').references(() => listings.id, { onDelete: 'set null' }),
  phoneE164:         text('phone_e164'),
  phoneCapturedAt:   timestamp('phone_captured_at', { withTimezone: true }),
  messageCount:      integer('message_count').notNull().default(0),
  lastMessageAt:     timestamp('last_message_at', { withTimezone: true }),
  processingUntil:   timestamp('processing_until', { withTimezone: true }),
  expiresAt:         timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt:         timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  orgIdx: index('idx_agent_web_sessions_org').on(t.orgId, t.createdAt),
}));

export const agentWebHandoffCodes = pgTable('agent_web_handoff_codes', {
  id:                 uuid('id').primaryKey().defaultRandom(),
  orgId:              uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  // Phase 8: nullable — voice codes (source='voice') have no web session.
  webSessionId:       uuid('web_session_id').references(() => agentWebSessions.id, { onDelete: 'cascade' }),
  code:               text('code').notNull(),
  kind:               text('kind').notNull(), // 'visit'|'continue'
  leadId:             uuid('lead_id').references(() => crmLeads.id, { onDelete: 'set null' }),
  listingId:          uuid('listing_id').references(() => listings.id, { onDelete: 'set null' }),
  profileId:          uuid('profile_id').references(() => profiles.id, { onDelete: 'set null' }),
  startsAt:           timestamp('starts_at', { withTimezone: true }),
  visitMinutes:       integer('visit_minutes'),
  status:             text('status').notNull().default('pending'),
  // 'pending'|'redeemed'|'failed'|'expired'|'superseded'
  redeemedPhone:      text('redeemed_phone'),
  redeemedSessionId:  uuid('redeemed_session_id').references(() => agentSessions.id, { onDelete: 'set null' }),
  visitId:            uuid('visit_id').references(() => propertyVisits.id, { onDelete: 'set null' }),
  result:             text('result'),
  expiresAt:          timestamp('expires_at', { withTimezone: true }).notNull(),
  redeemedAt:         timestamp('redeemed_at', { withTimezone: true }),
  createdAt:          timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  // Phase 8: 'web'|'voice'. Voice codes ('VOZ-XXXXXX') carry a call_id and
  // redeem only from target_phone — see src/lib/widget/handoff-codes.ts.
  source:             text('source').notNull().default('web'),
  callId:             uuid('call_id').references(() => agentCalls.id, { onDelete: 'set null' }),
  targetPhone:        text('target_phone'),
}, (t) => ({
  orgCodeUniq: uniqueIndex('uq_web_handoff_code').on(t.orgId, t.code),
  sessionIdx:  index('idx_web_handoff_session').on(t.webSessionId, t.status),
  voicePhoneIdx: index('idx_handoff_voice_phone').on(t.orgId, t.targetPhone, t.status).where(sql`source = 'voice'`),
}));

export const agentWebUsageDaily = pgTable('agent_web_usage_daily', {
  orgId:    uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  day:      date('day').notNull(),
  sessions: integer('sessions').notNull().default(0),
  messages: integer('messages').notNull().default(0),
}, (t) => ({
  pk: primaryKey({ columns: [t.orgId, t.day] }),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Domain table: agent_calls — Phase 8 (voice AI / Vapi). One row per inbound
// or outbound call, from 'queued' through 'ended'/'failed'/'skipped'/'blocked'.
// See src/lib/agent/voice/calls.ts (the only write path).
// ─────────────────────────────────────────────────────────────────────────────

export const agentCalls = pgTable('agent_calls', {
  id:               uuid('id').primaryKey().defaultRandom(),
  orgId:            uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  sessionId:        uuid('session_id').references(() => agentSessions.id, { onDelete: 'set null' }),
  leadId:           uuid('lead_id').references(() => crmLeads.id, { onDelete: 'set null' }),
  visitId:          uuid('visit_id').references(() => propertyVisits.id, { onDelete: 'set null' }),
  direction:        text('direction').notNull(),   // 'inbound'|'outbound'
  purpose:          text('purpose').notNull(),      // 'inbound'|'speed_to_lead'|'visit_confirmation'|'reactivation'
  status:           text('status').notNull().default('queued'),
  // 'queued'|'dialing'|'in_progress'|'ended'|'failed'|'skipped'|'blocked'
  blockReason:      text('block_reason'),
  dedupeKey:        text('dedupe_key'),
  vapiCallId:       text('vapi_call_id').unique(),
  phoneNumberId:    text('phone_number_id'),
  customerPhone:    text('customer_phone'),
  startedAt:        timestamp('started_at', { withTimezone: true }),
  endedAt:          timestamp('ended_at', { withTimezone: true }),
  durationSeconds:  integer('duration_seconds'),
  endedReason:      text('ended_reason'),
  outcome:          text('outcome'), // 'answered'|'no_answer'|'busy'|'voicemail'|'failed'|'abandoned'
  transcript:       text('transcript'),
  recordingUrl:     text('recording_url'),
  summary:          text('summary'),
  costUsd:          numeric('cost_usd', { precision: 10, scale: 4 }),
  costBreakdown:    jsonb('cost_breakdown'),
  createdAt:        timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:        timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  dedupeUniq: uniqueIndex('agent_calls_dedupe').on(t.orgId, t.dedupeKey).where(sql`dedupe_key IS NOT NULL`),
  orgCreatedIdx: index('idx_agent_calls_org_created').on(t.orgId, t.createdAt),
  orgStatusIdx:  index('idx_agent_calls_org_status').on(t.orgId, t.status),
  leadIdx:       index('idx_agent_calls_lead').on(t.leadId),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Domain table: voice_do_not_call — Phase 8. Org-scoped DNC list, checked by
// the outbound compliance gate (src/lib/agent/voice/compliance.ts) alongside
// crm_leads.do_not_contact. 'caller_request' rows are permanent (staff can't
// remove them from the settings UI — see removeDoNotCall's 'protected').
// ─────────────────────────────────────────────────────────────────────────────

export const voiceDoNotCall = pgTable('voice_do_not_call', {
  orgId:            uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  phoneE164:        text('phone_e164').notNull(),
  reason:           text('reason'),
  source:           text('source').notNull(), // 'staff'|'caller_request'
  addedByProfileId: uuid('added_by_profile_id').references(() => profiles.id, { onDelete: 'set null' }),
  createdAt:        timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  pk: primaryKey({ columns: [t.orgId, t.phoneE164] }),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Domain table: agent_session_listings — Phase 9. Every listing id a session
// has actually seen (search_listings / attribution / page) — the only ids
// send_listing_card / send_listing_photos are allowed to act on.
// ─────────────────────────────────────────────────────────────────────────────

export const agentSessionListings = pgTable('agent_session_listings', {
  sessionId:  uuid('session_id').notNull().references(() => agentSessions.id, { onDelete: 'cascade' }),
  orgId:      uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  listingId:  uuid('listing_id').notNull().references(() => listings.id, { onDelete: 'cascade' }),
  source:     text('source').notNull(), // 'search'|'attribution'|'page'
  createdAt:  timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  pk: primaryKey({ columns: [t.sessionId, t.listingId] }),
}));
