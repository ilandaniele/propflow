/**
 * Org isolation Phase 2 tests — Drizzle / app-layer.
 * Replaces Supabase RLS phase 2 isolation tests.
 */

import { describe, it, expect } from 'vitest';
import { units, contracts, tenantTasks, sanctions, announcements } from '@/lib/db/schema';
import { getTableColumns } from 'drizzle-orm';

describe('App-layer org isolation Phase 2 — schema audit (AC8)', () => {
  const orgScopedTables = [
    { name: 'units', table: units },
    { name: 'contracts', table: contracts },
    { name: 'tenant_tasks', table: tenantTasks },
    { name: 'sanctions', table: sanctions },
    { name: 'announcements', table: announcements },
  ];

  for (const { name, table } of orgScopedTables) {
    it(`${name} table has orgId column for app-layer isolation`, () => {
      const cols = getTableColumns(table);
      expect(Object.keys(cols)).toContain('orgId');
    });
  }
});
