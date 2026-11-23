import type { MercadoPagoPayment } from './mercadopago';

export type PaymentMatch = 'ok' | 'not_approved' | 'reference_mismatch' | 'amount_mismatch';

interface IntentForMatch {
  id: string;
  amount: string;
  currency: string;
}

export function toCents(value: string | number): number {
  return Math.round(Number(value) * 100);
}

export function matchPaymentToIntent(payment: MercadoPagoPayment, intent: IntentForMatch): PaymentMatch {
  if (payment.status !== 'approved') return 'not_approved';
  if (payment.external_reference !== intent.id) return 'reference_mismatch';
  if (payment.currency_id !== intent.currency) return 'amount_mismatch';
  if (toCents(payment.transaction_amount) !== toCents(intent.amount)) return 'amount_mismatch';
  return 'ok';
}
