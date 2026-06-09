/**
 * Airtable env validation — server-only.
 *
 * AC8: assertAirtableEnv() throws Errors.INTERNAL with code AIRTABLE_NOT_CONFIGURED
 * when AIRTABLE_PAT or AIRTABLE_BASE_ID is missing. No HTTP request is issued.
 *
 * The four entity table env vars (AIRTABLE_TABLE_RESIDENTES etc.) are OPTIONAL.
 * A missing var means that entity table is skipped for sync (AC7).
 * Use resolveEntityTableEnvKey() to read them — it returns null when unset.
 *
 * NEVER use NEXT_PUBLIC_AIRTABLE_* prefixes — all Airtable vars are server-only.
 * This module MUST only be imported in Server Components, Server Actions, or Route Handlers.
 */

export interface AirtableEnv {
  pat: string;
  baseId: string;
  // Existing table env vars (legacy sync targets — may be empty strings when unset)
  tableRooms: string;
  tablePerformance: string;
  tableKpis: string;
  // Entity table env vars — null when the var is not set (table is skipped)
  tableResidentes: string | null;
  tablePropiedades: string | null;
  tablePagos: string | null;
  tableHistorial: string | null;
  tablePortafolio: string | null;
  tableResponsables: string | null;
}

export class AirtableNotConfiguredError extends Error {
  readonly code = 'AIRTABLE_NOT_CONFIGURED' as const;

  constructor(missing: string[]) {
    super(
      `[airtable] Required environment variable(s) missing: ${missing.join(', ')}. ` +
      'Add them to .env.local (dev) or Vercel environment variables (staging/prod). ' +
      'NEVER use NEXT_PUBLIC_ prefix for Airtable credentials.'
    );
    this.name = 'AirtableNotConfiguredError';
  }
}

/**
 * Validates all required Airtable environment variables at call time.
 *
 * Calling convention: call this at the top of any function that will issue
 * Airtable HTTP requests — BEFORE any fetch call — so that a misconfigured
 * environment fails fast with a clear error rather than an auth 401 from Airtable.
 *
 * Entity table vars (AIRTABLE_TABLE_RESIDENTES, PROPIEDADES, PAGOS, HISTORIAL) are
 * NOT required — their absence causes the corresponding table to be skipped, not an error.
 *
 * @throws {AirtableNotConfiguredError} when AIRTABLE_PAT or AIRTABLE_BASE_ID is absent
 */
export function assertAirtableEnv(): AirtableEnv {
  const missing: string[] = [];

  const pat = process.env['AIRTABLE_PAT'];
  if (!pat) missing.push('AIRTABLE_PAT');

  const baseId = process.env['AIRTABLE_BASE_ID'];
  if (!baseId) missing.push('AIRTABLE_BASE_ID');

  // Legacy table env vars — kept as empty string when unset (backward-compatible)
  const tableRooms = process.env['AIRTABLE_TABLE_ROOMS'] ?? '';
  const tablePerformance = process.env['AIRTABLE_TABLE_PERFORMANCE'] ?? '';
  const tableKpis = process.env['AIRTABLE_TABLE_KPIS'] ?? '';

  // Entity table env vars — null means "skip this table" (AC7)
  const tableResidentes  = process.env['AIRTABLE_TABLE_RESIDENTES']  ?? null;
  const tablePropiedades = process.env['AIRTABLE_TABLE_PROPIEDADES'] ?? null;
  const tablePagos       = process.env['AIRTABLE_TABLE_PAGOS']       ?? null;
  const tableHistorial      = process.env['AIRTABLE_TABLE_HISTORIAL']      ?? null;
  const tablePortafolio     = process.env['AIRTABLE_TABLE_PORTAFOLIO']     ?? null;
  const tableResponsables   = process.env['AIRTABLE_TABLE_RESPONSABLES']   ?? null;

  if (missing.length > 0) {
    throw new AirtableNotConfiguredError(missing);
  }

  return {
    pat: pat!,
    baseId: baseId!,
    tableRooms,
    tablePerformance,
    tableKpis,
    tableResidentes,
    tablePropiedades,
    tablePagos,
    tableHistorial,
    tablePortafolio,
    tableResponsables,
  };
}

/**
 * Resolve a table identifier from an env-var key name.
 * e.g. tableEnvKey = 'AIRTABLE_TABLE_ROOMS' → returns the table id/name string.
 *
 * @throws {AirtableNotConfiguredError} when the table env var is missing
 */
export function resolveTableEnvKey(tableEnvKey: string): string {
  const value = process.env[tableEnvKey];
  if (!value) {
    throw new AirtableNotConfiguredError([tableEnvKey]);
  }
  return value;
}

/**
 * Resolve an entity table env-var key without throwing.
 *
 * Returns the table name string when the env var is set and non-empty.
 * Returns null when the var is absent or empty — the caller should skip that table (AC7).
 *
 * Recognised entity keys:
 *   AIRTABLE_TABLE_RESIDENTES
 *   AIRTABLE_TABLE_PROPIEDADES
 *   AIRTABLE_TABLE_PAGOS
 *   AIRTABLE_TABLE_HISTORIAL
 *
 * Unknown keys are also handled safely — they return null (no throw).
 */
export function resolveEntityTableEnvKey(tableEnvKey: string): string | null {
  const value = process.env[tableEnvKey];
  if (!value || value.trim() === '') return null;
  return value;
}
