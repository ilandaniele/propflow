/**
 * src/lib/csv/parsePaymentsCsv.ts
 *
 * Server-only CSV parsing for payment imports.
 * No DB calls — pure parsing and validation logic.
 */

export interface ParsedPaymentRow {
  rowNumber: number;
  external_payment_id?: string;
  tenant_email?: string;
  tenant_id?: string;
  payment_date: string;
  due_date?: string;
  amount: number;
  currency: string;
  status: string;
  payment_method: string;
  billing_period?: string;
  property?: string;
  unit?: string;
  room?: string;
  reference?: string;
  description?: string;
}

export interface RowError {
  rowNumber: number;
  field: string;
  message: string;
}

export interface RowWarning {
  rowNumber: number;
  field: string;
  message: string;
}

export interface ParsePaymentsCsvResult {
  rows: ParsedPaymentRow[];
  errors: RowError[];
  warnings: RowWarning[];
}

const VALID_CURRENCIES = ['PEN', 'USD', 'EUR'];
const VALID_STATUSES   = ['pending', 'approved', 'under_review'];
const VALID_METHODS    = ['cash', 'transfer', 'card', 'other'];
const DATE_RE          = /^\d{4}-\d{2}-\d{2}$/;

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/\s+/g, '_');
}

function parseDate(val: string, field: string, rowNumber: number, errors: RowError[]): string | null {
  const v = val.trim();
  if (!v) return null;
  if (!DATE_RE.test(v)) {
    errors.push({ rowNumber, field, message: `Fecha inválida "${v}" — use formato YYYY-MM-DD.` });
    return null;
  }
  return v;
}

function parseAmount(val: string, rowNumber: number, errors: RowError[]): number | null {
  const v = val.trim();
  const n = parseFloat(v);
  if (isNaN(n)) {
    errors.push({ rowNumber, field: 'amount', message: `Monto inválido "${v}" — debe ser un número decimal.` });
    return null;
  }
  if (n < 0) {
    errors.push({ rowNumber, field: 'amount', message: `Monto negativo "${v}" no permitido.` });
    return null;
  }
  if (n > 999999) {
    errors.push({ rowNumber, field: 'amount', message: `Monto "${v}" excede el límite permitido (999,999).` });
    return null;
  }
  return n;
}

/**
 * Parses a CSV string into structured payment rows.
 * Lines starting with '#' are treated as comments and skipped.
 */
export function parsePaymentsCsv(csvText: string): ParsePaymentsCsvResult {
  const rows: ParsedPaymentRow[]  = [];
  const errors: RowError[]         = [];
  const warnings: RowWarning[]     = [];

  // Strip comment lines and split
  const lines = csvText
    .split('\n')
    .filter(l => !l.trimStart().startsWith('#') && l.trim().length > 0);

  if (lines.length < 2) {
    errors.push({ rowNumber: 0, field: 'file', message: 'El archivo CSV está vacío o solo contiene comentarios.' });
    return { rows, errors, warnings };
  }

  // Parse header
  const headerLine = lines[0];
  const headers = headerLine.split(',').map(normalizeHeader);

  const REQUIRED = ['payment_date', 'amount'];
  for (const req of REQUIRED) {
    if (!headers.includes(req)) {
      errors.push({ rowNumber: 0, field: req, message: `Columna requerida "${req}" no encontrada en el encabezado.` });
    }
  }
  if (errors.length > 0) return { rows, errors, warnings };

  for (let i = 1; i < lines.length; i++) {
    const rowNumber = i;
    const values = lines[i].split(',');
    const raw: Record<string, string> = {};
    headers.forEach((h, idx) => { raw[h] = (values[idx] ?? '').trim(); });

    const rowErrors: RowError[] = [];

    // payment_date (required)
    const payment_date = parseDate(raw['payment_date'] ?? '', 'payment_date', rowNumber, rowErrors);
    if (!payment_date) {
      errors.push(...rowErrors);
      continue;
    }

    // amount (required)
    const amount = parseAmount(raw['amount'] ?? '', rowNumber, rowErrors);
    if (amount === null) {
      errors.push(...rowErrors);
      continue;
    }

    // currency
    const rawCurrency = (raw['currency'] ?? '').toUpperCase();
    let currency = rawCurrency || 'PEN';
    if (rawCurrency && !VALID_CURRENCIES.includes(rawCurrency)) {
      rowErrors.push({ rowNumber, field: 'currency', message: `Moneda "${rawCurrency}" inválida. Use: ${VALID_CURRENCIES.join(', ')}.` });
      currency = 'PEN';
    }

    // status
    const rawStatus = (raw['status'] ?? '').toLowerCase();
    let status = rawStatus || 'pending';
    if (rawStatus && !VALID_STATUSES.includes(rawStatus)) {
      rowErrors.push({ rowNumber, field: 'status', message: `Estado "${rawStatus}" inválido. Use: ${VALID_STATUSES.join(', ')}.` });
      status = 'pending';
    }

    // payment_method
    const rawMethod = (raw['payment_method'] ?? '').toLowerCase();
    let payment_method = rawMethod || 'transfer';
    if (rawMethod && !VALID_METHODS.includes(rawMethod)) {
      warnings.push({ rowNumber, field: 'payment_method', message: `Método "${rawMethod}" desconocido — se usará "transfer".` });
      payment_method = 'transfer';
    }

    // due_date (optional)
    const rawDueDate = raw['due_date'] ?? '';
    let due_date: string | undefined;
    if (rawDueDate) {
      const parsed = parseDate(rawDueDate, 'due_date', rowNumber, rowErrors);
      due_date = parsed ?? undefined;
    }

    // tenant_email normalize
    const tenant_email = raw['tenant_email'] ? raw['tenant_email'].trim().toLowerCase() : undefined;

    if (rowErrors.length > 0) {
      errors.push(...rowErrors);
      continue;
    }

    rows.push({
      rowNumber,
      external_payment_id: raw['external_payment_id'] || undefined,
      tenant_email,
      tenant_id: raw['tenant_id'] || undefined,
      payment_date,
      due_date,
      amount,
      currency,
      status,
      payment_method,
      billing_period: raw['billing_period'] || undefined,
      property: raw['property'] || undefined,
      unit: raw['unit'] || undefined,
      room: raw['room'] || undefined,
      reference: raw['reference'] || undefined,
      description: raw['description'] || undefined,
    });
  }

  return { rows, errors, warnings };
}
