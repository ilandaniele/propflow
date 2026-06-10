/**
 * src/lib/csv/parseTenantsCsv.ts
 *
 * Server-only CSV parsing for tenant imports.
 * No DB calls — pure parsing and validation.
 * DB matching (update vs create) is done in the API route.
 */

export type TenantRowAction = 'create' | 'update' | 'skip' | 'conflict' | 'invalid';

export interface ParsedTenantRow {
  rowNumber: number;
  action: TenantRowAction;
  external_tenant_id?: string;
  first_name: string;
  last_name: string;
  email: string;
  phone?: string;
  document_number?: string;
  date_of_birth?: string;
  emergency_contact_name?: string;
  emergency_contact_phone?: string;
  status: string;
  move_in_date?: string;
  preferred_language: string;
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

export interface ParseTenantsCsvResult {
  rows: ParsedTenantRow[];
  errors: RowError[];
  warnings: RowWarning[];
}

const EMAIL_RE  = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_RE   = /^\d{4}-\d{2}-\d{2}$/;
const VALID_STATUSES   = ['active', 'inactive', 'pending'];
const VALID_LANGUAGES  = ['es', 'en'];

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

/**
 * Parses CSV text into structured tenant rows.
 * Lines starting with '#' are treated as comments.
 * DB matching (update/create resolution) is handled by the caller.
 */
export function parseTenantsCsv(csvText: string): ParseTenantsCsvResult {
  const rows: ParsedTenantRow[] = [];
  const errors: RowError[]       = [];
  const warnings: RowWarning[]   = [];

  const lines = csvText
    .split('\n')
    .filter(l => !l.trimStart().startsWith('#') && l.trim().length > 0);

  if (lines.length < 2) {
    errors.push({ rowNumber: 0, field: 'file', message: 'El archivo CSV está vacío o solo contiene comentarios.' });
    return { rows, errors, warnings };
  }

  const headers = lines[0].split(',').map(normalizeHeader);
  const REQUIRED = ['first_name', 'last_name', 'email'];
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

    // Required fields
    const first_name = raw['first_name'] ?? '';
    const last_name  = raw['last_name'] ?? '';
    const email      = (raw['email'] ?? '').trim().toLowerCase();

    if (!first_name) rowErrors.push({ rowNumber, field: 'first_name', message: 'El nombre es requerido.' });
    if (!last_name)  rowErrors.push({ rowNumber, field: 'last_name',  message: 'El apellido es requerido.' });
    if (!email)      rowErrors.push({ rowNumber, field: 'email',      message: 'El email es requerido.' });
    else if (!EMAIL_RE.test(email)) {
      rowErrors.push({ rowNumber, field: 'email', message: `Email inválido: "${email}".` });
    }

    if (rowErrors.length > 0) {
      errors.push(...rowErrors);
      rows.push({ rowNumber, action: 'invalid', first_name, last_name, email, status: 'pending', preferred_language: 'es' });
      continue;
    }

    // Status
    const rawStatus = (raw['status'] ?? '').toLowerCase();
    let status = rawStatus || 'pending';
    if (rawStatus && !VALID_STATUSES.includes(rawStatus)) {
      warnings.push({ rowNumber, field: 'status', message: `Estado "${rawStatus}" inválido — se usará "pending".` });
      status = 'pending';
    }

    // preferred_language
    const rawLang = (raw['preferred_language'] ?? '').toLowerCase();
    let preferred_language = rawLang || 'es';
    if (rawLang && !VALID_LANGUAGES.includes(rawLang)) {
      warnings.push({ rowNumber, field: 'preferred_language', message: `Idioma "${rawLang}" inválido — se usará "es".` });
      preferred_language = 'es';
    }

    // Optional dates
    const date_of_birth = parseDate(raw['date_of_birth'] ?? '', 'date_of_birth', rowNumber, rowErrors) ?? undefined;
    const move_in_date  = parseDate(raw['move_in_date'] ?? '', 'move_in_date', rowNumber, rowErrors) ?? undefined;

    if (rowErrors.length > 0) {
      errors.push(...rowErrors);
      rows.push({ rowNumber, action: 'invalid', first_name, last_name, email, status, preferred_language });
      continue;
    }

    rows.push({
      rowNumber,
      action: 'create', // resolved to 'update' by the API route after DB lookup
      external_tenant_id: raw['external_tenant_id'] || undefined,
      first_name,
      last_name,
      email,
      phone: raw['phone'] || undefined,
      document_number: raw['document_number'] || undefined,
      date_of_birth,
      emergency_contact_name: raw['emergency_contact_name'] || undefined,
      emergency_contact_phone: raw['emergency_contact_phone'] || undefined,
      status,
      move_in_date,
      preferred_language,
    });
  }

  return { rows, errors, warnings };
}
