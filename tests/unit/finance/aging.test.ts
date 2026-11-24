import { describe, it, expect } from 'vitest';
import { computeAging, type AgingCharge } from '@/lib/finance/aging';

const charge = (dueDate: string, amount = 100, tenantId = 't1'): AgingCharge => ({ tenantId, amount, dueDate });
const TODAY = '2026-11-22';

describe('computeAging', () => {
  it('buckets unpaid overdue charges by days late', () => {
    const rows = computeAging(
      [charge('2026-11-10'), charge('2026-10-10'), charge('2026-09-10'), charge('2026-07-01')],
      new Map(),
      TODAY,
    );
    expect(rows).toEqual([{ tenantId: 't1', buckets: { '0_30': 100, '31_60': 100, '61_90': 100, '90_plus': 100 }, total: 400 }]);
  });

  it('applies payments to the oldest charges first', () => {
    const rows = computeAging([charge('2026-11-10'), charge('2026-07-01')], new Map([['t1', 150]]), TODAY);
    expect(rows[0].buckets).toEqual({ '0_30': 50, '31_60': 0, '61_90': 0, '90_plus': 0 });
  });

  it('ignores charges not yet due', () => {
    expect(computeAging([charge('2026-11-22'), charge('2026-12-05')], new Map(), TODAY)).toEqual([]);
  });

  it('drops tenants whose payments cover every overdue charge', () => {
    expect(computeAging([charge('2026-10-01')], new Map([['t1', 100]]), TODAY)).toEqual([]);
  });

  it('sorts tenants by total owed, largest first', () => {
    const rows = computeAging([charge('2026-11-01', 50, 'a'), charge('2026-11-01', 300, 'b')], new Map(), TODAY);
    expect(rows.map((row) => row.tenantId)).toEqual(['b', 'a']);
  });

  it('places a charge exactly 30 days late in the first bucket', () => {
    expect(computeAging([charge('2026-10-23')], new Map(), TODAY)[0].buckets['0_30']).toBe(100);
  });
});
