// Cells starting with these characters can trigger formula execution when the
// CSV is opened in Excel/Sheets ("formula injection"), so they get a literal
// quote prefix and are read back as text.
const FORMULA_PREFIX_RE = /^[=+\-@\t\r]/;

// E.164 phone numbers ("+51987654321") start with '+' but are never formulas.
const E164_PHONE_RE = /^\+\d+$/;

export function escapeCsvCell(raw: string): string {
  let cell = raw;
  if (FORMULA_PREFIX_RE.test(cell) && !E164_PHONE_RE.test(cell)) cell = `'${cell}`;
  if (/["\r\n]/.test(cell) || cell.includes(',')) {
    return `"${cell.replace(/"/g, '""')}"`;
  }
  return cell;
}

/** RFC 4180 CSV with UTF-8 BOM so Excel opens accents correctly. */
export function toCsvDocument(header: string[], rows: string[][]): string {
  const lines = [header, ...rows].map((cells) => cells.map(escapeCsvCell).join(','));
  return '﻿' + lines.join('\r\n') + '\r\n';
}
