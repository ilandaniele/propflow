import type { PaymentReceipt } from './payment-receipt';

export function formatReceiptAmount(receipt: Pick<PaymentReceipt, 'amount' | 'currency'>): string {
  return `${receipt.currency} ${Number(receipt.amount).toFixed(2)}`;
}
