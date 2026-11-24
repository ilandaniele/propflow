import { escapeCsvCell } from '@/lib/csv/escape';

export const ACCOUNTS = {
  cash: '1011',
  bank: '1041',
  rentIncome: '7542',
  expense: '639',
} as const;

export interface JournalPayment {
  id: string;
  paidAt: string;
  amount: string;
  currency: string;
  method: string;
  tenantName: string | null;
  reference: string | null;
}

export interface JournalExpense {
  id: string;
  incurredOn: string;
  amount: string;
  description: string;
  categoryName: string | null;
}

export interface JournalLine {
  date: string;
  entry: number;
  account: string;
  description: string;
  debit: string;
  credit: string;
  currency: string;
  reference: string;
}

const fixed2 = (amount: string) => Number(amount).toFixed(2);

function entryLines(
  entry: number,
  date: string,
  debitAccount: string,
  creditAccount: string,
  amount: string,
  currency: string,
  description: string,
  reference: string,
): JournalLine[] {
  const value = fixed2(amount);
  const base = { date, entry, description, currency, reference };
  return [
    { ...base, account: debitAccount, debit: value, credit: '0.00' },
    { ...base, account: creditAccount, debit: '0.00', credit: value },
  ];
}

export function buildJournal(payments: JournalPayment[], expenses: JournalExpense[]): JournalLine[] {
  const events = [
    ...payments.map((p) => ({ date: p.paidAt, lines: (entry: number) => entryLines(
      entry, p.paidAt,
      p.method === 'cash' ? ACCOUNTS.cash : ACCOUNTS.bank, ACCOUNTS.rentIncome,
      p.amount, p.currency,
      ['Cobro alquiler', p.tenantName].filter(Boolean).join(' - '),
      p.reference ?? p.id,
    ) })),
    ...expenses.map((e) => ({ date: e.incurredOn, lines: (entry: number) => entryLines(
      entry, e.incurredOn,
      ACCOUNTS.expense, ACCOUNTS.bank,
      e.amount, 'PEN',
      [e.categoryName, e.description].filter(Boolean).join(' - '),
      e.id,
    ) })),
  ].sort((a, b) => a.date.localeCompare(b.date));
  return events.flatMap((event, index) => event.lines(index + 1));
}

const HEADER = ['fecha', 'asiento', 'cuenta', 'glosa', 'debe', 'haber', 'moneda', 'referencia'];

export function journalToCsv(lines: JournalLine[]): string {
  const rows = lines.map((l) => [
    l.date, String(l.entry), l.account, l.description, l.debit, l.credit, l.currency, l.reference,
  ]);
  return '﻿' + [HEADER, ...rows].map((cells) => cells.map(escapeCsvCell).join(',')).join('\r\n') + '\r\n';
}
