import { sqliteTable, text, integer, uniqueIndex, index, check } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { id, json, ts, money, dateStr, bool } from './columns';
import { contracts, organizations, profiles, properties, tenants, units, whatsappMessages } from './core';

export const charges = sqliteTable('charges', {
  id:          id(),
  orgId:       text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  contractId:  text('contract_id').notNull().references(() => contracts.id, { onDelete: 'cascade' }),
  tenantId:    text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  period:      dateStr('period'),
  description: text('description'),
  amount:      money('amount').notNull(),
  dueDate:     dateStr('due_date'),
  createdAt:   ts('created_at').notNull().$defaultFn(() => new Date()),
  updatedAt:   ts('updated_at').notNull().$defaultFn(() => new Date()),
}, (t) => [
  index('idx_charges_org_id').on(t.orgId),
  index('idx_charges_contract_id').on(t.contractId),
  index('idx_charges_tenant_period').on(t.tenantId, t.period),
  check('charges_amount_check', sql`CAST(amount AS REAL) > 0`),
]);

export const importLogs = sqliteTable('import_logs', {
  id:                  id(),
  orgId:               text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  importType:          text('import_type').notNull(),  // 'tenant'|'payment'|'room_performance'|'financial'
  fileName:            text('file_name'),
  importedBy:          text('imported_by').references(() => profiles.id, { onDelete: 'set null' }),
  role:                text('role'),
  status:              text('status').notNull().default('pending'),
  rowsReceived:        integer('rows_received').default(0),
  rowsCreated:         integer('rows_created').default(0),
  rowsUpdated:         integer('rows_updated').default(0),
  rowsSkipped:         integer('rows_skipped').default(0),
  rowsFailed:          integer('rows_failed').default(0),
  validationWarnings:  json<unknown>('validation_warnings').default([]),
  errorDetails:        json<unknown>('error_details').default([]),
  airtableSyncResult:  json<unknown>('airtable_sync_result'),
  createdAt:           ts('created_at').notNull().$defaultFn(() => new Date()),
  completedAt:         ts('completed_at'),
}, () => [
  check('import_logs_import_type_check', sql`import_type IN ('tenant','payment','room_performance','financial')`),
  check('import_logs_status_check', sql`status IN ('pending','completed','failed','partial')`),
]);

export const payments = sqliteTable('payments', {
  id:                 id(),
  orgId:              text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  contractId:         text('contract_id').notNull().references(() => contracts.id, { onDelete: 'cascade' }),
  tenantId:           text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  amount:             money('amount').notNull(),
  paidAt:             dateStr('paid_at').notNull(),
  method:             text('method').notNull().default('transfer'),  // 'cash'|'transfer'|'card'|'other'
  status:             text('status').notNull().default('pending'),   // 'pending'|'approved'|'under_review'|'rejected'
  approvedBy:         text('approved_by').references(() => profiles.id, { onDelete: 'set null' }),
  approvedAt:         ts('approved_at'),
  reference:          text('reference'),
  currency:           text('currency').notNull().default('PEN'),
  receiptUrl:         text('receipt_url'),
  movementType:       text('movement_type').notNull().default('payment'),
  externalPaymentId:  text('external_payment_id'),
  importSource:       text('import_source').default('manual'),
  importId:           text('import_id').references(() => importLogs.id, { onDelete: 'set null' }),
  airtableExternalId: text('airtable_external_id'),
  airtableSyncedAt:   ts('airtable_synced_at'),
  name:               text('name'),
  periodMonth:        text('period_month'),
  dueDate:            dateStr('due_date'),
  phone:              text('phone'),
  tenantName:         text('tenant_name'),
  previousBalanceApplied:money('previous_balance_applied'),
  previousAddlBalanceApplied:money('previous_addl_balance_applied'),
  daysOverdue:        integer('days_overdue'),
  concept:            text('concept'),
  createdAt:          ts('created_at').notNull().$defaultFn(() => new Date()),
  updatedAt:          ts('updated_at').notNull().$defaultFn(() => new Date()),
}, (t) => [
  index('idx_payments_org_id').on(t.orgId),
  index('idx_payments_contract_id').on(t.contractId),
  index('idx_payments_tenant_id').on(t.tenantId),
  index('idx_payments_org_status').on(t.orgId, t.status),
  index('idx_payments_org_status_paid').on(t.orgId, t.status, t.paidAt),
  uniqueIndex('payments_org_airtable_uniq').on(t.orgId, t.airtableExternalId),
  uniqueIndex('payments_org_external_id_uidx').on(t.orgId, t.externalPaymentId),
  check('payments_amount_check', sql`CAST(amount AS REAL) > 0`),
  check('payments_method_check', sql`method IN ('cash', 'transfer', 'card', 'other')`),
  check('payments_status_check', sql`status IN ('pending','approved','under_review','rejected')`),
  check('payments_movement_type_check', sql`movement_type IN ('rent_charge','payment','partial_payment','deposit','sanction','discount','adjustment','refund','other')`),
  check('payments_import_source_check', sql`import_source IN ('manual','csv_import','airtable','google_onboarding')`),
]);

export const receiptUploads = sqliteTable('receipt_uploads', {
  id:              id(),
  orgId:           text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  paymentId:       text('payment_id').references(() => payments.id, { onDelete: 'set null' }),
  uploadedBy:      text('uploaded_by').notNull().references(() => profiles.id, { onDelete: 'cascade' }),
  filePath:        text('file_path').notNull(),
  ocrStatus:       text('ocr_status').notNull().default('pending'),
  extractedAmount: money('extracted_amount'),
  extractedDate:   dateStr('extracted_date'),
  extractedVendor: text('extracted_vendor'),
  confidence:      money('confidence'),
  ocrError:        text('ocr_error'),
  createdAt:       ts('created_at').notNull().$defaultFn(() => new Date()),
  updatedAt:       ts('updated_at').notNull().$defaultFn(() => new Date()),
}, (t) => [
  index('idx_receipt_uploads_org').on(t.orgId),
  index('idx_receipt_uploads_org_status').on(t.orgId, t.ocrStatus),
  index('idx_receipt_uploads_payment').on(t.paymentId),
  index('idx_receipt_uploads_uploader').on(t.uploadedBy),
  check('receipt_uploads_ocr_status_check', sql`ocr_status IN ('pending','processing','extracted','failed','matched')`),
  check('receipt_uploads_confidence_check', sql`CAST(confidence AS REAL) >= 0 AND CAST(confidence AS REAL) <= 1`),
]);

export const paymentReceipts = sqliteTable('payment_receipts', {
  id:               id(),
  orgId:            text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  tenantId:         text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  source:           text('source').notNull().default('whatsapp'),  // 'whatsapp' | 'manual'
  whatsappMessageId: text('whatsapp_message_id').references(() => whatsappMessages.id, { onDelete: 'set null' }),
  imagePath:        text('image_path').notNull(),
  imageSha256:      text('image_sha256').notNull(),
  extractedAmount:  money('extracted_amount'),
  extractedDate:    dateStr('extracted_date'),
  extractedVendor:  text('extracted_vendor'),
  confidence:       money('confidence'),
  matchedChargeId:  text('matched_charge_id').references(() => charges.id, { onDelete: 'set null' }),
  matchedPaymentId: text('matched_payment_id').references(() => payments.id, { onDelete: 'set null' }),
  status:           text('status').notNull().default('pending_review'),
  rejectionReason:  text('rejection_reason'),
  createdAt:        ts('created_at').notNull().$defaultFn(() => new Date()),
  updatedAt:        ts('updated_at').notNull().$defaultFn(() => new Date()),
}, (t) => [
  index('idx_pr_org_status').on(t.orgId, t.status, t.createdAt),
  index('idx_pr_tenant').on(t.tenantId, t.createdAt),
  index('idx_pr_sha256').on(t.imageSha256),
  uniqueIndex('payment_receipts_sha256_per_org').on(t.orgId, t.imageSha256),
  check('payment_receipts_source_check', sql`source IN ('whatsapp', 'manual')`),
  check('payment_receipts_status_check', sql`status IN ('pending_review','auto_approved','admin_approved','rejected','duplicate_rejected')`),
]);

export const servicePayments = sqliteTable('service_payments', {
  id:                 id(),
  orgId:              text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  propertyId:         text('property_id').references(() => properties.id, { onDelete: 'set null' }),
  airtableExternalId: text('airtable_external_id'),
  airtableSyncedAt:   ts('airtable_synced_at'),
  serviceType:        text('service_type').notNull(),  // 'agua'|'internet'|'gas'|'luz'|'otro'
  supplyNumber:       text('supply_number'),
  tope:               money('tope'),
  monthlyData:        json<unknown>('monthly_data'),
  createdAt:          ts('created_at').$defaultFn(() => new Date()),
  updatedAt:          ts('updated_at').$defaultFn(() => new Date()),
}, (t) => [
  uniqueIndex('service_payments_org_airtable_uniq').on(t.orgId, t.airtableExternalId),
  check('service_payments_service_type_check', sql`service_type IN ('agua','internet','gas','luz','otro')`),
]);

export const sanctions = sqliteTable('sanctions', {
  id:             id(),
  orgId:          text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  tenantId:       text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  proposedBy:     text('proposed_by').notNull().references(() => profiles.id, { onDelete: 'restrict' }),
  kind:           text('kind').notNull(),  // 'monetary'|'warning'
  title:          text('title').notNull(),
  reason:         text('reason').notNull(),
  amount:         money('amount'),
  status:         text('status').notNull().default('proposed'),
  linkedChargeId: text('linked_charge_id').unique().references(() => charges.id, { onDelete: 'set null' }),
  approvedBy:     text('approved_by').references(() => profiles.id, { onDelete: 'set null' }),
  approvedAt:     ts('approved_at'),
  disputeReason:  text('dispute_reason'),
  disputedAt:     ts('disputed_at'),
  resolutionNote: text('resolution_note'),
  resolvedAt:     ts('resolved_at'),
  createdAt:      ts('created_at').notNull().$defaultFn(() => new Date()),
  updatedAt:      ts('updated_at').notNull().$defaultFn(() => new Date()),
}, (t) => [
  index('idx_sanctions_org_status').on(t.orgId, t.status, t.createdAt),
  index('idx_sanctions_tenant').on(t.tenantId, t.createdAt),
  check('sanctions_kind_check', sql`kind IN ('monetary','warning')`),
  check('sanctions_status_check', sql`status IN ('proposed','approved','rejected','disputed','resolved')`),
  check('sanctions_monetary_amount', sql`kind <> 'monetary' OR amount IS NOT NULL`),
  check('sanctions_warning_no_amount', sql`kind <> 'warning' OR amount IS NULL`),
]);

export const chargeConcepts = sqliteTable('charge_concepts', {
  id:                 id(),
  orgId:              text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  airtableId:         text('airtable_id'),
  airtableSyncedAt:   ts('airtable_synced_at'),
  code:               text('code'),
  description:        text('description').notNull(),
  tipo:               text('tipo'),
  baseAmount:         money('base_amount'),
  notes:              text('notes'),
  createdAt:          ts('created_at').notNull().$defaultFn(() => new Date()),
  updatedAt:          ts('updated_at').notNull().$defaultFn(() => new Date()),
}, (t) => [
  index('idx_charge_concepts_org').on(t.orgId),
  uniqueIndex('uq_charge_concepts_airtable').on(t.orgId, t.airtableId),
]);

export const additionalCharges = sqliteTable('additional_charges', {
  id:               id(),
  orgId:            text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  airtableId:       text('airtable_id'),
  airtableSyncedAt: ts('airtable_synced_at'),
  contractId:       text('contract_id').references(() => contracts.id, { onDelete: 'set null' }),
  conceptId:        text('concept_id').references(() => chargeConcepts.id, { onDelete: 'set null' }),
  mes:              text('mes'),
  anio:             integer('anio'),
  amount:           money('amount').notNull(),
  description:      text('description'),
  numero:           integer('numero'),
  createdAt:        ts('created_at').notNull().$defaultFn(() => new Date()),
  updatedAt:        ts('updated_at').notNull().$defaultFn(() => new Date()),
}, (t) => [
  index('idx_additional_charges_org').on(t.orgId),
  index('idx_additional_charges_org_anio').on(t.orgId, t.anio),
  index('idx_additional_charges_contract').on(t.contractId),
  uniqueIndex('uq_additional_charges_airtable').on(t.orgId, t.airtableId),
]);

export const accountStatements = sqliteTable('account_statements', {
  id:                    id(),
  orgId:                 text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  airtableId:            text('airtable_id'),
  airtableSyncedAt:      ts('airtable_synced_at'),
  contractId:            text('contract_id').references(() => contracts.id, { onDelete: 'set null' }),
  eeccCode:              text('eecc_code'),
  mes:                   text('mes'),
  anio:                  integer('anio'),
  issueDate:             dateStr('issue_date'),
  dueDate:               dateStr('due_date'),
  rentAmount:            money('rent_amount'),
  additionalSubtotal:    money('additional_subtotal'),
  previousRentBalance:   money('previous_rent_balance'),
  previousAddlBalance:   money('previous_addl_balance'),
  totalDue:              money('total_due'),
  sendStatus:            text('send_status'),
  sendDate:              dateStr('send_date'),
  pdfUrl:                text('pdf_url'),
  whatsappMessageId:     text('whatsapp_message_id'),
  sendError:             text('send_error'),
  createdAt:             ts('created_at').notNull().$defaultFn(() => new Date()),
  updatedAt:             ts('updated_at').notNull().$defaultFn(() => new Date()),
}, (t) => [
  index('idx_account_statements_org').on(t.orgId),
  index('idx_account_statements_org_send_status').on(t.orgId, t.sendStatus),
  index('idx_account_statements_contract').on(t.contractId),
  index('idx_account_statements_date').on(t.orgId, t.anio, t.mes),
  uniqueIndex('uq_account_statements_airtable').on(t.orgId, t.airtableId),
]);

export const taxReceipts = sqliteTable('tax_receipts', {
  id:               id(),
  orgId:            text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  airtableId:       text('airtable_id'),
  airtableSyncedAt: ts('airtable_synced_at'),
  contractId:       text('contract_id').references(() => contracts.id, { onDelete: 'set null' }),
  receiptCode:      text('receipt_code'),
  tipo:             text('tipo'),
  numero:           text('numero'),
  mes:              text('mes'),
  anio:             integer('anio'),
  issueDate:        dateStr('issue_date'),
  baseAmount:       money('base_amount'),
  includesIgv:      bool('includes_igv').default(false),
  igvAmount:        money('igv_amount'),
  totalAmount:      money('total_amount'),
  status:           text('status'),
  fileUrl:          text('file_url'),
  createdAt:        ts('created_at').notNull().$defaultFn(() => new Date()),
  updatedAt:        ts('updated_at').notNull().$defaultFn(() => new Date()),
}, (t) => [
  index('idx_tax_receipts_org').on(t.orgId),
  index('idx_tax_receipts_contract').on(t.contractId),
  uniqueIndex('uq_tax_receipts_airtable').on(t.orgId, t.airtableId),
]);

export const depositAccounts = sqliteTable('deposit_accounts', {
  id:                 id(),
  orgId:              text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  airtableExternalId: text('airtable_external_id'),
  airtableSyncedAt:   ts('airtable_synced_at'),
  name:               text('name'),
  banco:              text('banco'),
  tipoCuenta:         text('tipo_cuenta'),
  moneda:             text('moneda'),
  numeroCuenta:       text('numero_cuenta'),
  cci:                text('cci'),
  createdAt:          ts('created_at').notNull().$defaultFn(() => new Date()),
  updatedAt:          ts('updated_at').notNull().$defaultFn(() => new Date()),
}, (t) => [
  index('idx_deposit_accounts_org').on(t.orgId),
  uniqueIndex('deposit_accounts_org_airtable_uniq').on(t.orgId, t.airtableExternalId),
]);

export const expenseCategories = sqliteTable('expense_categories', {
  id:        id(),
  orgId:     text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  name:      text('name').notNull(),
  color:     text('color'),
  createdAt: ts('created_at').notNull().$defaultFn(() => new Date()),
  updatedAt: ts('updated_at').notNull().$defaultFn(() => new Date()),
}, (t) => [
  index('idx_expense_categories_org').on(t.orgId),
  uniqueIndex('expense_categories_org_name_uniq').on(t.orgId, t.name),
]);

export const expenses = sqliteTable('expenses', {
  id:          id(),
  orgId:       text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  propertyId:  text('property_id').references(() => properties.id, { onDelete: 'set null' }),
  unitId:      text('unit_id').references(() => units.id, { onDelete: 'set null' }),
  categoryId:  text('category_id').references(() => expenseCategories.id, { onDelete: 'set null' }),
  amount:      money('amount').notNull(),
  description: text('description').notNull(),
  incurredOn:  dateStr('incurred_on').notNull(),
  receiptPath: text('receipt_path'),
  createdAt:   ts('created_at').notNull().$defaultFn(() => new Date()),
  updatedAt:   ts('updated_at').notNull().$defaultFn(() => new Date()),
}, (t) => [
  index('idx_expenses_org').on(t.orgId),
  index('idx_expenses_org_date').on(t.orgId, t.incurredOn),
  index('idx_expenses_property').on(t.propertyId),
  index('idx_expenses_category').on(t.categoryId),
  check('expenses_amount_check', sql`CAST(amount AS REAL) > 0`),
]);

export const aiTokenBudget = sqliteTable('ai_token_budget', {
  id:         id(),
  orgId:      text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  day:        dateStr('day').notNull(),
  tokensUsed: integer('tokens_used').notNull().default(0),
  costUsd:    money('cost_usd').notNull().default('0'),
  updatedAt:  ts('updated_at').notNull().$defaultFn(() => new Date()),
}, (t) => [
  uniqueIndex('idx_ai_token_budget_org_day').on(t.orgId, t.day),
  index('idx_ai_token_budget_org').on(t.orgId, t.day),
  check('ai_token_budget_tokens_used_check', sql`tokens_used >= 0`),
  check('ai_token_budget_cost_usd_check', sql`CAST(cost_usd AS REAL) >= 0`),
]);

export const rentAdjustments = sqliteTable('rent_adjustments', {
  id:           id(),
  orgId:        text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  contractId:   text('contract_id').notNull().references(() => contracts.id, { onDelete: 'cascade' }),
  previousRent: money('previous_rent').notNull(),
  newRent:      money('new_rent').notNull(),
  percent:      money('percent').notNull(),
  effectiveOn:  dateStr('effective_on').notNull(),
  createdBy:    text('created_by').references(() => profiles.id, { onDelete: 'set null' }),
  createdAt:    ts('created_at').notNull().$defaultFn(() => new Date()),
  updatedAt:    ts('updated_at').notNull().$defaultFn(() => new Date()),
}, (t) => [
  index('idx_rent_adjustments_org_contract').on(t.orgId, t.contractId),
  check('rent_adjustments_new_rent_check', sql`CAST(new_rent AS REAL) > 0`),
]);
