export const PAYABLE_STATUSES = ['pending', 'partial', 'paid', 'overdue'] as const;
export type PayableStatus = (typeof PAYABLE_STATUSES)[number];

export function toCents(amount: string | number): number {
  return Math.round(Number(amount) * 100);
}

export function saldoCents(amountCents: number, paidCents: number): number {
  return Math.max(0, amountCents - paidCents);
}

export function derivePayableStatus(input: {
  amountCents: number;
  paidCents: number;
  dueOn: string;
  today: string;
}): PayableStatus {
  if (saldoCents(input.amountCents, input.paidCents) === 0) return 'paid';
  if (input.dueOn < input.today) return 'overdue';
  return input.paidCents > 0 ? 'partial' : 'pending';
}
