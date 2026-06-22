/**
 * Import logs schema tests — Drizzle.
 * Replaces Supabase RLS import_logs tests.
 */

import { describe, it, expect } from 'vitest';
import { importLogs } from '@/lib/db/schema';
import { getTableColumns } from 'drizzle-orm';

describe('import_logs — schema audit (AC8)', () => {
  it('import_logs has orgId column for app-layer isolation', () => {
    const cols = getTableColumns(importLogs);
    expect(Object.keys(cols)).toContain('orgId');
  });
});
