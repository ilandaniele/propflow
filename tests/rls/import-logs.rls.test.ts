/**
 * Import logs schema tests — Drizzle.
 * Replaces Supabase migration SQL static checks.
 */

import { describe, it, expect } from 'vitest';
import { importLogs } from '@/lib/db/schema';
import { getTableColumns } from 'drizzle-orm';

describe('import_logs — schema audit (AC8)', () => {
  it('import_logs has orgId column', () => {
    const cols = getTableColumns(importLogs);
    expect(Object.keys(cols)).toContain('orgId');
  });

  it('import_logs has status column', () => {
    const cols = getTableColumns(importLogs);
    expect(Object.keys(cols)).toContain('status');
  });
});
