import { describe, it, expect } from 'vitest';
import { currentPeriod } from '@/lib/recurring-expenses/period';
import { CreateRecurringExpenseSchema, ToggleRecurringExpenseSchema } from '@/lib/recurring-expenses/schemas';

describe('currentPeriod', () => {
  it('uses Lima time, not UTC', () => {
    expect(currentPeriod(new Date('2026-12-01T03:00:00Z'))).toBe('2026-11');
    expect(currentPeriod(new Date('2026-12-01T06:00:00Z'))).toBe('2026-12');
  });
});

describe('CreateRecurringExpenseSchema', () => {
  const base = { description: ' Vigilancia ', amount: '350', day_of_month: '5' };

  it('coerces numbers, trims text and treats empty selects as absent', () => {
    expect(CreateRecurringExpenseSchema.parse({ ...base, property_id: '', category_id: '' })).toEqual({
      description: 'Vigilancia', amount: 350, day_of_month: 5, property_id: undefined, category_id: undefined,
    });
  });

  it.each([['0'], ['29'], ['1.5']])('rejects day %s', (day) => {
    expect(CreateRecurringExpenseSchema.safeParse({ ...base, day_of_month: day }).success).toBe(false);
  });

  it('rejects non-positive amounts and malformed ids', () => {
    expect(CreateRecurringExpenseSchema.safeParse({ ...base, amount: '0' }).success).toBe(false);
    expect(CreateRecurringExpenseSchema.safeParse({ ...base, property_id: 'nope' }).success).toBe(false);
  });
});

describe('ToggleRecurringExpenseSchema', () => {
  it('parses the active flag from form text', () => {
    const id = crypto.randomUUID();
    expect(ToggleRecurringExpenseSchema.parse({ id, active: 'false' })).toEqual({ id, active: false });
    expect(ToggleRecurringExpenseSchema.safeParse({ id, active: 'yes' }).success).toBe(false);
  });
});
