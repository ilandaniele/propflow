import { describe, it, expect } from 'vitest';
import { computePaymentKpis, type PaymentKpiRow } from '@/lib/finance/payment-kpis';

const row = (o: Partial<PaymentKpiRow>): PaymentKpiRow => ({
  amount: 0, status: 'approved', ...o,
});

describe('computePaymentKpis', () => {
  it('sums approved and pending totals across ALL rows (the #50 regression)', () => {
    const rows: PaymentKpiRow[] = [
      row({ status: 'approved', amount: '100.50' }),
      row({ status: 'approved', amount: 200 }),
      row({ status: 'pending', amount: '50' }),
      row({ status: 'pending', amount: 25 }),
      row({ status: 'rejected', amount: 999 }), // excluded from both
    ];
    const k = computePaymentKpis(rows);
    expect(k.collectedTotal).toBe(300.5);
    expect(k.pendingTotal).toBe(75);
    expect(k.totalCount).toBe(5);
    expect(k.approvedCount).toBe(2);
    expect(k.pendingCount).toBe(2);
  });

  it('collection rate = round(approved / total * 100)', () => {
    // 1 approved of 3 total = 33%
    const k = computePaymentKpis([
      row({ status: 'approved' }), row({ status: 'pending' }), row({ status: 'pending' }),
    ]);
    expect(k.collectionRate).toBe(33);
  });

  it('handles an empty set without dividing by zero', () => {
    const k = computePaymentKpis([]);
    expect(k).toMatchObject({ collectedTotal: 0, pendingTotal: 0, collectionRate: 0, totalCount: 0 });
    expect(k.byMethod).toEqual({});
    expect(k.byMonth).toEqual({});
  });

  it('byMethod counts approved payments per method; null → "other"', () => {
    const k = computePaymentKpis([
      row({ status: 'approved', method: 'transfer' }),
      row({ status: 'approved', method: 'transfer' }),
      row({ status: 'approved', method: 'cash' }),
      row({ status: 'approved', method: null }),
      row({ status: 'pending', method: 'transfer' }), // pending not counted
    ]);
    expect(k.byMethod).toEqual({ transfer: 2, cash: 1, other: 1 });
  });

  it('byMonth buckets approved amounts by YYYY-MM (paid_at, falling back to created_at)', () => {
    const k = computePaymentKpis([
      row({ status: 'approved', amount: 100, paidAt: '2026-07-15' }),
      row({ status: 'approved', amount: 50, paidAt: '2026-07-02' }),
      row({ status: 'approved', amount: 30, paidAt: null, createdAt: '2026-06-20T10:00:00Z' }),
      row({ status: 'approved', amount: 999, paidAt: null, createdAt: null }), // no date → skipped
      row({ status: 'pending', amount: 500, paidAt: '2026-07-01' }), // pending not counted
    ]);
    expect(k.byMonth).toEqual({ '2026-07': 150, '2026-06': 30 });
  });
});
