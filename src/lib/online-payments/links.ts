import { and, eq, inArray } from 'drizzle-orm';
import { db } from '@/lib/db';
import { charges, paymentIntents } from '@/lib/db/schema';
import { generatePayToken } from './token';
import type { PaymentProviderAdapter } from './types';

const LINK_TTL_MS = 7 * 24 * 60 * 60_000;
const CURRENCY = 'PEN';
const DEFAULT_TITLE = 'Cobro de alquiler';

export type PaymentLinkOutcome =
  | { kind: 'ok'; token: string; reused: boolean }
  | { kind: 'not_found' }
  | { kind: 'already_paid' };

async function findChargeWithOpenIntent(orgId: string, chargeId: string) {
  const [row] = await db
    .select({
      chargeId:    charges.id,
      amount:      charges.amount,
      description: charges.description,
      intentId:    paymentIntents.id,
      token:       paymentIntents.token,
      status:      paymentIntents.status,
      provider:    paymentIntents.provider,
      expiresAt:   paymentIntents.expiresAt,
    })
    .from(charges)
    .leftJoin(paymentIntents, and(eq(paymentIntents.chargeId, charges.id), inArray(paymentIntents.status, ['pending', 'paid'])))
    .where(and(eq(charges.id, chargeId), eq(charges.orgId, orgId)))
    .limit(1);
  return row ?? null;
}

async function expireIntent(intentId: string, now: Date) {
  await db
    .update(paymentIntents)
    .set({ status: 'expired', updatedAt: now })
    .where(and(eq(paymentIntents.id, intentId), eq(paymentIntents.status, 'pending')));
}

export async function createOrReusePaymentLink(
  orgId: string,
  chargeId: string,
  adapter: PaymentProviderAdapter,
  now = new Date(),
): Promise<PaymentLinkOutcome> {
  const row = await findChargeWithOpenIntent(orgId, chargeId);
  if (!row) return { kind: 'not_found' };
  if (row.status === 'paid') return { kind: 'already_paid' };
  if (row.intentId && row.token && row.expiresAt) {
    const reusable = row.provider === adapter.name && row.expiresAt > now;
    if (reusable) return { kind: 'ok', token: row.token, reused: true };
    await expireIntent(row.intentId, now);
  }

  const intent = {
    id: crypto.randomUUID(),
    orgId,
    chargeId,
    token: generatePayToken(),
    provider: adapter.name,
    amount: row.amount,
    currency: CURRENCY,
    expiresAt: new Date(now.getTime() + LINK_TTL_MS),
    createdAt: now,
    updatedAt: now,
  };
  const inserted = await db.insert(paymentIntents).values(intent).onConflictDoNothing().returning({ id: paymentIntents.id });
  if (inserted.length === 0) return createOrReusePaymentLink(orgId, chargeId, adapter, now);

  try {
    const checkout = await adapter.createCheckout({
      intentId: intent.id,
      chargeId,
      token: intent.token,
      title: row.description?.trim() || DEFAULT_TITLE,
      amount: intent.amount,
      currency: intent.currency,
      expiresAt: intent.expiresAt,
    });
    await db
      .update(paymentIntents)
      .set({ providerRef: checkout.providerRef, checkoutUrl: checkout.checkoutUrl, updatedAt: new Date() })
      .where(eq(paymentIntents.id, intent.id));
  } catch (error) {
    await db.update(paymentIntents).set({ status: 'failed', updatedAt: new Date() }).where(eq(paymentIntents.id, intent.id));
    throw error;
  }
  return { kind: 'ok', token: intent.token, reused: false };
}
