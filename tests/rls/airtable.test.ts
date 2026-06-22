/**
 * Airtable schema isolation tests — Drizzle.
 * Replaces Supabase RLS tests for airtable_snapshots and airtable_sync_logs.
 * These tables now use app-layer org isolation (AC8).
 */

import { describe, it, expect } from 'vitest';
import { airtableSnapshots, airtableSyncLogs } from '@/lib/db/schema';
import { getTableColumns } from 'drizzle-orm';

describe('Airtable tables — schema audit (AC8)', () => {
  it('airtable_snapshots has orgId column', () => {
    const cols = getTableColumns(airtableSnapshots);
    expect(Object.keys(cols)).toContain('orgId');
  });

  it('airtable_sync_logs has orgId column', () => {
    const cols = getTableColumns(airtableSyncLogs);
    expect(Object.keys(cols)).toContain('orgId');
  });
});
