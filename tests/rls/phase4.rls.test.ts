/**
 * Phase 4 isolation tests — Drizzle / app-layer.
 * Replaces Supabase RLS phase4 tests.
 */

import { describe, it, expect } from 'vitest';
import { tenantFeedback, taxReceipts, additionalCharges, accountStatements } from '@/lib/db/schema';
import { getTableColumns } from 'drizzle-orm';

describe('Phase 4 tables — schema audit (AC8)', () => {
  const tables = [
    { name: 'tenant_feedback', table: tenantFeedback },
    { name: 'tax_receipts', table: taxReceipts },
    { name: 'additional_charges', table: additionalCharges },
    { name: 'account_statements', table: accountStatements },
  ];

  for (const { name, table } of tables) {
    it(`${name} has orgId column for app-layer isolation`, () => {
      const cols = getTableColumns(table);
      expect(Object.keys(cols)).toContain('orgId');
    });
  }
});
