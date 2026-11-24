import Papa from 'papaparse';

export const MAX_STATEMENT_LINES = 1000;
const HEADER_SEARCH_ROWS = 20;

export type StatementLine = {
  fingerprint: string;
  postedOn: string;
  description: string;
  reference: string | null;
  amount: string;
};

export type ParsedStatement =
  | { status: 'no_header' }
  | { status: 'too_many_rows' }
  | { status: 'ok'; lines: StatementLine[]; skipped: number };

type Columns = { date: number; description: number; reference: number; amount: number; credit: number; debit: number };

const normalize = (value: string) => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

const KEYWORDS: Record<keyof Columns, string[]> = {
  date: ['fecha', 'date', 'f operacion'],
  description: ['descripcion', 'concepto', 'detalle', 'glosa', 'description'],
  reference: ['referencia', 'reference', 'nro', 'numero', 'n operacion', 'num operacion'],
  amount: ['monto', 'importe', 'amount'],
  credit: ['abono', 'credito', 'ingreso', 'credit', 'haber'],
  debit: ['cargo', 'debito', 'egreso', 'debit', 'debe'],
};

function findColumn(headers: string[], key: keyof Columns): number {
  return headers.findIndex((header) => KEYWORDS[key].some((word) => header === word || header.startsWith(`${word} `)));
}

function detectColumns(row: string[]): Columns | null {
  const headers = row.map(normalize);
  const columns = Object.fromEntries(
    (Object.keys(KEYWORDS) as (keyof Columns)[]).map((key) => [key, findColumn(headers, key)]),
  ) as Columns;
  const hasAmount = columns.amount >= 0 || columns.credit >= 0;
  return columns.date >= 0 && columns.description >= 0 && hasAmount ? columns : null;
}

export function parseStatementDate(raw: string): string | null {
  const value = raw.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const local = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(value);
  if (!local) return null;
  const [, day, month, rawYear] = local;
  const year = rawYear.length === 2 ? `20${rawYear}` : rawYear;
  const date = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  return Number.isNaN(Date.parse(date)) ? null : date;
}

export function parseStatementAmount(raw: string): number | null {
  let value = raw.replace(/S\/|US\$|\$|PEN|USD|\s/gi, '');
  if (!value) return null;
  const negative = value.startsWith('-') || value.endsWith('-') || (value.startsWith('(') && value.endsWith(')'));
  value = value.replace(/[()\-+]/g, '');
  const lastComma = value.lastIndexOf(',');
  const lastDot = value.lastIndexOf('.');
  const decimalComma = lastComma > lastDot && value.length - lastComma - 1 === 2;
  value = decimalComma ? value.replace(/\./g, '').replace(',', '.') : value.replace(/,/g, '');
  if (!/^\d+(\.\d+)?$/.test(value)) return null;
  const amount = Number(value);
  return negative ? -amount : amount;
}

function lineAmount(row: string[], columns: Columns): number | null {
  if (columns.credit >= 0) {
    const credit = parseStatementAmount(row[columns.credit] ?? '') ?? 0;
    const debit = columns.debit >= 0 ? Math.abs(parseStatementAmount(row[columns.debit] ?? '') ?? 0) : 0;
    return credit - debit;
  }
  return parseStatementAmount(row[columns.amount] ?? '');
}

export function parseStatement(text: string): ParsedStatement {
  const rows = Papa.parse<string[]>(text.replace(/^﻿/, ''), { skipEmptyLines: 'greedy' }).data;
  const headerIndex = rows.slice(0, HEADER_SEARCH_ROWS).findIndex((row) => detectColumns(row) !== null);
  if (headerIndex < 0) return { status: 'no_header' };
  const columns = detectColumns(rows[headerIndex])!;
  const body = rows.slice(headerIndex + 1);
  if (body.length > MAX_STATEMENT_LINES) return { status: 'too_many_rows' };

  const seen = new Map<string, number>();
  const lines: StatementLine[] = [];
  let skipped = 0;
  for (const row of body) {
    const postedOn = parseStatementDate(row[columns.date] ?? '');
    const amount = lineAmount(row, columns);
    if (!postedOn || amount === null || amount <= 0) {
      skipped += 1;
      continue;
    }
    const description = (row[columns.description] ?? '').trim().slice(0, 300);
    const reference = columns.reference >= 0 ? (row[columns.reference] ?? '').trim().slice(0, 80) || null : null;
    const fixed = amount.toFixed(2);
    const base = [postedOn, fixed, description, reference ?? ''].join('|');
    const occurrence = (seen.get(base) ?? 0) + 1;
    seen.set(base, occurrence);
    lines.push({ fingerprint: `${base}|${occurrence}`, postedOn, description, reference, amount: fixed });
  }
  return { status: 'ok', lines, skipped };
}
