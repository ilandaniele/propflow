const FORMULA_PREFIX_RE = /^[=+\-@\t\r]/;
const E164_PHONE_RE = /^\+\d+$/;

export function escapeCsvCell(raw: string): string {
  let cell = raw;
  if (FORMULA_PREFIX_RE.test(cell) && !E164_PHONE_RE.test(cell)) cell = `'${cell}`;
  if (/["\r\n]/.test(cell) || cell.includes(',')) {
    return `"${cell.replace(/"/g, '""')}"`;
  }
  return cell;
}

export const CSV_BOM = '﻿';

export function toCsvLine(cells: Array<string | number | null>): string {
  return cells.map((cell) => escapeCsvCell(cell == null ? '' : String(cell))).join(',') + '\r\n';
}

export function toCsvDocument(header: string[], rows: Array<Array<string | number | null>>): string {
  return CSV_BOM + [header, ...rows].map(toCsvLine).join('');
}
