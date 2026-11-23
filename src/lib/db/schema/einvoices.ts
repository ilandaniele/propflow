import { sqliteTable, text, integer, uniqueIndex, index, check } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { id, json, ts, money } from './columns';
import { organizations } from './core';
import { charges } from './finance';

export const einvoiceSeries = sqliteTable('einvoice_series', {
  id:         id(),
  orgId:      text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  docType:    text('doc_type').notNull(),
  series:     text('series').notNull(),
  nextNumber: integer('next_number').notNull().default(1),
  createdAt:  ts('created_at').notNull().$defaultFn(() => new Date()),
}, (t) => [
  uniqueIndex('einvoice_series_org_type_series_uniq').on(t.orgId, t.docType, t.series),
  check('einvoice_series_doc_type_check', sql`doc_type IN ('boleta','factura')`),
  check('einvoice_series_next_number_check', sql`next_number >= 1`),
]);

export const einvoices = sqliteTable('einvoices', {
  id:                id(),
  orgId:             text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  chargeId:          text('charge_id').notNull().references(() => charges.id, { onDelete: 'restrict' }),
  docType:           text('doc_type').notNull(),
  series:            text('series').notNull(),
  number:            integer('number').notNull(),
  customerDocType:   text('customer_doc_type').notNull(),
  customerDocNumber: text('customer_doc_number'),
  customerName:      text('customer_name').notNull(),
  total:             money('total').notNull(),
  base:              money('base').notNull(),
  igv:               money('igv').notNull(),
  currency:          text('currency').notNull().default('PEN'),
  provider:          text('provider').notNull(),
  status:            text('status').notNull().default('pending'),
  providerResponse:  json<unknown>('provider_response'),
  pdfUrl:            text('pdf_url'),
  error:             text('error'),
  createdAt:         ts('created_at').notNull().$defaultFn(() => new Date()),
  updatedAt:         ts('updated_at').notNull().$defaultFn(() => new Date()),
}, (t) => [
  uniqueIndex('einvoices_org_series_number_uniq').on(t.orgId, t.series, t.number),
  uniqueIndex('einvoices_charge_uniq').on(t.chargeId),
  index('idx_einvoices_org_created').on(t.orgId, t.createdAt),
  check('einvoices_doc_type_check', sql`doc_type IN ('boleta','factura')`),
  check('einvoices_customer_doc_type_check', sql`customer_doc_type IN ('dni','ruc','none')`),
  check('einvoices_provider_check', sql`provider IN ('sandbox','nubefact')`),
  check('einvoices_status_check', sql`status IN ('pending','accepted_sandbox','sent','accepted','rejected','error')`),
]);
