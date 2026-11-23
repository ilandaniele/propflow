import { sqliteTable, text, index, uniqueIndex, check } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { id, ts, money } from './columns';
import { organizations } from './core';
import { charges } from './finance';

export const paymentIntents = sqliteTable('payment_intents', {
  id:                id(),
  orgId:             text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  chargeId:          text('charge_id').notNull().references(() => charges.id, { onDelete: 'cascade' }),
  token:             text('token').notNull(),
  provider:          text('provider', { enum: ['sandbox', 'mercadopago'] }).notNull(),
  status:            text('status', { enum: ['pending', 'paid', 'expired', 'failed'] }).notNull().default('pending'),
  amount:            money('amount').notNull(),
  currency:          text('currency').notNull().default('PEN'),
  providerRef:       text('provider_ref'),
  checkoutUrl:       text('checkout_url'),
  providerPaymentId: text('provider_payment_id'),
  amountPaid:        money('amount_paid'),
  paidAt:            ts('paid_at'),
  expiresAt:         ts('expires_at').notNull(),
  createdAt:         ts('created_at').notNull().$defaultFn(() => new Date()),
  updatedAt:         ts('updated_at').notNull().$defaultFn(() => new Date()),
}, (t) => [
  uniqueIndex('payment_intents_token_uidx').on(t.token),
  uniqueIndex('payment_intents_provider_payment_uidx').on(t.providerPaymentId),
  uniqueIndex('payment_intents_one_pending_per_charge').on(t.chargeId).where(sql`status = 'pending'`),
  index('idx_payment_intents_org_status').on(t.orgId, t.status),
  index('idx_payment_intents_org_created').on(t.orgId, t.createdAt),
  check('payment_intents_status_check', sql`status IN ('pending','paid','expired','failed')`),
  check('payment_intents_provider_check', sql`provider IN ('sandbox','mercadopago')`),
  check('payment_intents_token_check', sql`length(token) = 64`),
]);
