import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/lib/db';
import { paymentIntents } from '@/lib/db/schema';
import { isIntentPayable } from './format';
import { fetchMercadoPagoPayment } from './mercadopago';
import { matchPaymentToIntent, type PaymentMatch } from './payment-match';

interface Settlement {
  intentId: string;
  providerPaymentId: string;
  amountPaid: string;
  paidAt?: Date;
}

export async function markIntentPaid({ intentId, providerPaymentId, amountPaid, paidAt = new Date() }: Settlement): Promise<boolean> {
  const updated = await db
    .update(paymentIntents)
    .set({ status: 'paid', providerPaymentId, amountPaid, paidAt, updatedAt: paidAt })
    .where(and(eq(paymentIntents.id, intentId), inArray(paymentIntents.status, ['pending', 'expired'])))
    .returning({ id: paymentIntents.id });
  return updated.length > 0;
}

export type SimulateOutcome = 'paid' | 'already_paid' | 'not_found' | 'not_sandbox' | 'not_payable';

export async function simulateSandboxPayment(token: string, now = new Date()): Promise<SimulateOutcome> {
  const [intent] = await db
    .select({ id: paymentIntents.id, provider: paymentIntents.provider, status: paymentIntents.status, amount: paymentIntents.amount, expiresAt: paymentIntents.expiresAt })
    .from(paymentIntents)
    .where(eq(paymentIntents.token, token))
    .limit(1);
  if (!intent) return 'not_found';
  if (intent.provider !== 'sandbox') return 'not_sandbox';
  if (intent.status === 'paid') return 'already_paid';
  if (!isIntentPayable(intent, now)) return 'not_payable';
  const paid = await markIntentPaid({ intentId: intent.id, providerPaymentId: `sandbox_${intent.id}`, amountPaid: intent.amount, paidAt: now });
  return paid ? 'paid' : 'already_paid';
}

export type ReconcileOutcome = PaymentMatch | 'paid' | 'already_paid' | 'unknown_intent';

export async function reconcileMercadoPagoPayment(paymentId: string, accessToken: string): Promise<ReconcileOutcome> {
  const payment = await fetchMercadoPagoPayment(paymentId, accessToken);
  if (payment.status !== 'approved') return 'not_approved';
  const reference = payment.external_reference ?? '';
  if (!z.guid().safeParse(reference).success) return 'unknown_intent';

  const [intent] = await db
    .select({ id: paymentIntents.id, status: paymentIntents.status, amount: paymentIntents.amount, currency: paymentIntents.currency })
    .from(paymentIntents)
    .where(and(eq(paymentIntents.id, reference), eq(paymentIntents.provider, 'mercadopago')))
    .limit(1);
  if (!intent) return 'unknown_intent';
  if (intent.status === 'paid') return 'already_paid';

  const match = matchPaymentToIntent(payment, intent);
  if (match !== 'ok') return match;
  const paid = await markIntentPaid({ intentId: intent.id, providerPaymentId: payment.id, amountPaid: payment.transaction_amount.toFixed(2) });
  return paid ? 'paid' : 'already_paid';
}
