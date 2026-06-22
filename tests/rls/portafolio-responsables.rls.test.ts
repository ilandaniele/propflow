/**
 * Portafolio/Responsables schema tests — Drizzle.
 * Replaces Supabase migration SQL static checks.
 */

import { describe, it, expect } from 'vitest';
import { units, responsables } from '@/lib/db/schema';
import { getTableColumns } from 'drizzle-orm';

describe('Portafolio/Responsables — schema audit (AC8)', () => {
  it('units has airtableExternalId column', () => {
    const cols = getTableColumns(units);
    expect(Object.keys(cols)).toContain('airtableExternalId');
  });

  it('units has areaM2 column', () => {
    const cols = getTableColumns(units);
    expect(Object.keys(cols)).toContain('areaM2');
  });

  it('responsables has airtableExternalId column', () => {
    const cols = getTableColumns(responsables);
    expect(Object.keys(cols)).toContain('airtableExternalId');
  });

  it('responsables has orgId column for app-layer isolation', () => {
    const cols = getTableColumns(responsables);
    expect(Object.keys(cols)).toContain('orgId');
  });
});
