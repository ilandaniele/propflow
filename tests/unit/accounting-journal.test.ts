import { describe, it, expect } from 'vitest';
import { buildJournal, journalToCsv, ACCOUNTS } from '@/lib/accounting/journal';

const payment = {
  id: 'p1', paidAt: '2026-10-05', amount: '850', currency: 'PEN', method: 'transfer', tenantName: 'Ana', reference: 'OP-1',
};
const expense = {
  id: 'e1', incurredOn: '2026-10-02', amount: '120.5', description: 'Gasfitero', categoryName: 'Mantenimiento',
};

describe('buildJournal', () => {
  it('creates balanced double entries ordered by date', () => {
    const lines = buildJournal([payment], [expense]);
    expect(lines).toHaveLength(4);
    expect(lines[0]).toMatchObject({ entry: 1, account: ACCOUNTS.expense, debit: '120.50', credit: '0.00', description: 'Mantenimiento - Gasfitero' });
    expect(lines[1]).toMatchObject({ entry: 1, account: ACCOUNTS.bank, debit: '0.00', credit: '120.50' });
    expect(lines[2]).toMatchObject({ entry: 2, account: ACCOUNTS.bank, debit: '850.00', reference: 'OP-1', description: 'Cobro alquiler - Ana' });
    expect(lines[3]).toMatchObject({ entry: 2, account: ACCOUNTS.rentIncome, credit: '850.00' });
  });

  it('books cash payments to the cash account and falls back to id as reference', () => {
    const [debit] = buildJournal([{ ...payment, method: 'cash', reference: null, tenantName: null }], []);
    expect(debit).toMatchObject({ account: ACCOUNTS.cash, reference: 'p1', description: 'Cobro alquiler' });
  });

  it('keeps debits equal to credits', () => {
    const lines = buildJournal([payment, { ...payment, id: 'p2', amount: '10.10' }], [expense]);
    const sum = (key: 'debit' | 'credit') => lines.reduce((s, l) => s + Number(l[key]), 0);
    expect(sum('debit')).toBeCloseTo(sum('credit'));
  });
});

describe('journalToCsv', () => {
  it('writes BOM, header and escapes formula and comma cells', () => {
    const csv = journalToCsv(buildJournal([], [{ ...expense, description: '=HACK(), x', categoryName: null }]));
    expect(csv.startsWith('﻿fecha,asiento,cuenta,glosa,debe,haber,moneda,referencia\r\n')).toBe(true);
    expect(csv).toContain(`"'=HACK(), x"`);
  });
});
