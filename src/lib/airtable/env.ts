/**
 * Airtable env validation — server-only.
 *
 * AC8: assertAirtableEnv() throws Errors.INTERNAL with code AIRTABLE_NOT_CONFIGURED
 * when AIRTABLE_PAT or AIRTABLE_BASE_ID is missing. No HTTP request is issued.
 *
 * NEVER use NEXT_PUBLIC_AIRTABLE_* prefixes — all Airtable vars are server-only.
 * This module MUST only be imported in Server Components, Server Actions, or Route Handlers.
 */

export interface AirtableEnv {
  pat: string;
  baseId: string;
  tableRooms: string;
  tablePerformance: string;
  tableKpis: string;
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
 * @throws {AirtableNotConfiguredError} when AIRTABLE_PAT or AIRTABLE_BASE_ID is absent
 */
export function assertAirtableEnv(): AirtableEnv {
  const missing: string[] = [];

  const pat = process.env['AIRTABLE_PAT'];
  if (!pat) missing.push('AIRTABLE_PAT');

  const baseId = process.env['AIRTABLE_BASE_ID'];
  if (!baseId) missing.push('AIRTABLE_BASE_ID');

  // Table env vars are required only when used — but we surface them early if set
  const tableRooms = process.env['AIRTABLE_TABLE_ROOMS'] ?? '';
  const tablePerformance = process.env['AIRTABLE_TABLE_PERFORMANCE'] ?? '';
  const tableKpis = process.env['AIRTABLE_TABLE_KPIS'] ?? '';

  if (missing.length > 0) {
    throw new AirtableNotConfiguredError(missing);
  }

  return {
    pat: pat!,
    baseId: baseId!,
    tableRooms,
    tablePerformance,
    tableKpis,
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
