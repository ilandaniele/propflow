import { EXPENSE_KINDS, type ExpenseKind } from '@/lib/schemas/finance';

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

export function resolveMonth(value: string | undefined, today: Date): string {
  if (value && MONTH_PATTERN.test(value)) return value;
  return today.toISOString().slice(0, 7);
}

export function resolveKind(value: string | undefined): ExpenseKind | undefined {
  return EXPENSE_KINDS.find((kind) => kind === value);
}
