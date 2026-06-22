/**
 * Airtable entity sync schema tests — Drizzle.
 * Replaces static SQL migration checks for supabase/migrations/ (removed).
 * Verifies that airtable_external_id and airtable_synced_at columns exist
 * in the Drizzle schema for the relevant tables.
 */

import { describe, it, expect } from 'vitest';
import { properties, tenants, payments } from '@/lib/db/schema';
import { getTableColumns } from 'drizzle-orm';

describe('Airtable entity sync — schema columns (replaces migration SQL tests)', () => {
  const airtableTables = [
    { name: 'properties', table: properties },
    { name: 'tenants', table: tenants },
    { name: 'payments', table: payments },
  ];

  for (const { name, table } of airtableTables) {
    it(`${name} has airtableExternalId column`, () => {
      const cols = getTableColumns(table);
      expect(Object.keys(cols)).toContain('airtableExternalId');
    });

    it(`${name} has airtableSyncedAt column`, () => {
      const cols = getTableColumns(table);
      expect(Object.keys(cols)).toContain('airtableSyncedAt');
    });
  }

  it('org_id is present in all airtable-synced tables (AC8 isolation)', () => {
    for (const { name, table } of airtableTables) {
      const cols = getTableColumns(table);
      expect(Object.keys(cols), `${name} missing orgId`).toContain('orgId');
    }
  });
});
