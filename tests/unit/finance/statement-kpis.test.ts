import { describe, it, expect } from 'vitest';
import { computeStatementKpis, type StatementKpiRow } from '@/lib/finance/statement-kpis';

const TODAY = '2026-07-15';
const r = (o: Partial<StatementKpiRow>): StatementKpiRow => ({ ...o });

describe('computeStatementKpis', () => {
  it('sums totalDue / rent / additionals over ALL rows', () => {
    const k = computeStatementKpis([
      r({ totalDue: '100', rentAmount: 80, additionalSubtotal: '20' }),
      r({ totalDue: 50, rentAmount: '40', additionalSubtotal: 10 }),
      r({ totalDue: null, rentAmount: null, additionalSubtotal: null }),
    ], TODAY);
    expect(k.totalDue).toBe(150);
    expect(k.totalRent).toBe(120);
    expect(k.totalAddl).toBe(30);
    expect(k.additionalsPct).toBe(20); // 30/150
  });

  it('additionalsPct is 0 when totalDue is 0 (no divide-by-zero)', () => {
    expect(computeStatementKpis([r({ totalDue: 0, additionalSubtotal: 0 })], TODAY).additionalsPct).toBe(0);
  });

  it('counts sent / error / whatsapp / sendError', () => {
    const k = computeStatementKpis([
      r({ sendStatus: 'sent', whatsappMessageId: 'wa1' }),
      r({ sendStatus: 'error', sendError: 'boom' }),
      r({ sendStatus: 'pending' }),
    ], TODAY);
    expect(k.sentCount).toBe(1);
    expect(k.errorCount).toBe(1);
    expect(k.withWhatsapp).toBe(1);
    expect(k.withError).toBe(1);
  });

  it('overdue = past-due AND not sent; dueToday = due exactly today', () => {
    const k = computeStatementKpis([
      r({ dueDate: '2026-07-10', sendStatus: 'pending' }), // overdue
      r({ dueDate: '2026-07-10', sendStatus: 'sent' }),    // past due but sent → not overdue
      r({ dueDate: '2026-07-15', sendStatus: 'pending' }), // due today
      r({ dueDate: '2026-08-01', sendStatus: 'pending' }), // future
    ], TODAY);
    expect(k.overdue).toHaveLength(1);
    expect(k.overdue[0].dueDate).toBe('2026-07-10');
    expect(k.dueToday).toHaveLength(1);
    expect(k.dueToday[0].dueDate).toBe('2026-07-15');
  });

  it('empty set → zeros and empty arrays', () => {
    const k = computeStatementKpis([], TODAY);
    expect(k).toMatchObject({ totalDue: 0, totalRent: 0, totalAddl: 0, additionalsPct: 0, sentCount: 0 });
    expect(k.overdue).toEqual([]);
    expect(k.dueToday).toEqual([]);
  });
});
