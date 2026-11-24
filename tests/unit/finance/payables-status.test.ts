import { describe, it, expect } from 'vitest';
import { derivePayableStatus, saldoCents, toCents } from '@/lib/finance/payables/status';

const TODAY = '2026-11-23';

describe('toCents', () => {
  it('converts decimal text and numbers to integer cents without float drift', () => {
    expect(toCents('100')).toBe(10000);
    expect(toCents('33.33')).toBe(3333);
    expect(toCents(0.1 + 0.2)).toBe(30);
  });
});

describe('saldoCents', () => {
  it('is amount minus payments, never negative', () => {
    expect(saldoCents(10000, 0)).toBe(10000);
    expect(saldoCents(10000, 3333)).toBe(6667);
    expect(saldoCents(10000, 10000)).toBe(0);
    expect(saldoCents(10000, 12000)).toBe(0);
  });
});

describe('derivePayableStatus', () => {
  const base = { amountCents: 10000, dueOn: '2026-12-01', today: TODAY };

  it('is pending with no payments before the due date', () => {
    expect(derivePayableStatus({ ...base, paidCents: 0 })).toBe('pending');
  });

  it('is partial with some payments before the due date', () => {
    expect(derivePayableStatus({ ...base, paidCents: 4000 })).toBe('partial');
  });

  it('is paid once the balance reaches zero, even past due', () => {
    expect(derivePayableStatus({ ...base, paidCents: 10000 })).toBe('paid');
    expect(derivePayableStatus({ ...base, dueOn: '2026-01-01', paidCents: 10000 })).toBe('paid');
  });

  it('is overdue when past due with a remaining balance, partial or not', () => {
    expect(derivePayableStatus({ ...base, dueOn: '2026-11-22', paidCents: 0 })).toBe('overdue');
    expect(derivePayableStatus({ ...base, dueOn: '2026-11-22', paidCents: 4000 })).toBe('overdue');
  });

  it('is not overdue on the due date itself', () => {
    expect(derivePayableStatus({ ...base, dueOn: TODAY, paidCents: 0 })).toBe('pending');
  });
});
