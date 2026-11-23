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

export function toCsvDocument(header: string[], rows: Array<Array<string | number | null>>): string {
  const lines = [header, ...rows].map((cells) => cells.map((cell) => escapeCsvCell(cell == null ? '' : String(cell))).join(','));
  return '﻿' + lines.join('\r\n') + '\r\n';
}
