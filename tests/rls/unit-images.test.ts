/**
 * Unit images schema tests — Drizzle.
 * Replaces Supabase RLS unit_images tests.
 */

import { describe, it, expect } from 'vitest';
import { unitImages } from '@/lib/db/schema';
import { getTableColumns } from 'drizzle-orm';

describe('unit_images — schema audit (AC8)', () => {
  it('unit_images has orgId column for app-layer isolation', () => {
    const cols = getTableColumns(unitImages);
    expect(Object.keys(cols)).toContain('orgId');
  });
});
