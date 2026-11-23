import { describe, it, expect } from 'vitest';
import { currenciesInUse, formatMoney, groupByCurrency } from '@/lib/finance/currency';
import { buildCashFlow, computePnL } from '@/lib/finance/reports';

describe('groupByCurrency', () => {
  it('groups rows by currency and defaults missing currency to PEN', () => {
    const groups = groupByCurrency([
      { amount: 1, currency: 'USD' },
      { amount: 2 },
      { amount: 3, currency: 'PEN' },
    ]);
    expect(groups.get('PEN')?.map((r) => r.amount)).toEqual([2, 3]);
    expect(groups.get('USD')?.map((r) => r.amount)).toEqual([1]);
  });
});

describe('currenciesInUse', () => {
  it('puts base currency first, then the rest sorted', () => {
    const a = new Map([['USD', []], ['EUR', []]]);
    const b = new Map([['PEN', []]]);
    expect(currenciesInUse(a, b)).toEqual(['PEN', 'EUR', 'USD']);
  });

  it('returns empty when no rows', () => {
    expect(currenciesInUse(new Map(), new Map())).toEqual([]);
  });
});

describe('formatMoney', () => {
  it('uses currency symbol and two decimals', () => {
    expect(formatMoney('PEN', 1500)).toBe('S/ 1,500.00');
    expect(formatMoney('USD', 2.5)).toBe('US$ 2.50');
    expect(formatMoney('GBP', 1)).toBe('GBP 1.00');
  });
});

describe('per-currency P&L', () => {
  it('does not mix currencies when computed per group', () => {
    const income = groupByCurrency([
      { amount: 1000, paid_at: '2026-01-05', currency: 'PEN' },
      { amount: 300, paid_at: '2026-01-06', currency: 'USD' },
    ]);
    const expenses = groupByCurrency([{ amount: 100, incurred_on: '2026-01-07', currency: 'USD' }]);
    expect(computePnL(income.get('PEN') ?? [], expenses.get('PEN') ?? []).netIncome).toBe(1000);
    expect(computePnL(income.get('USD') ?? [], expenses.get('USD') ?? []).netIncome).toBe(200);
  });

  it('cash flow entries keep their currency', () => {
    const flow = buildCashFlow(
      [{ amount: 10, paid_at: '2026-01-01', currency: 'USD' }],
      [{ amount: 5, incurred_on: '2026-01-02' }],
    );
    expect(flow.map((e) => e.currency)).toEqual(['USD', 'PEN']);
  });
});
