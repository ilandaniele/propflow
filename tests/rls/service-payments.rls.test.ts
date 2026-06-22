/**
 * Service payments schema tests — Drizzle.
 * Replaces Supabase migration SQL static checks.
 */

import { describe, it, expect } from 'vitest';
import { servicePayments } from '@/lib/db/schema';
import { getTableColumns } from 'drizzle-orm';

describe('service_payments — schema audit (AC8)', () => {
  it('service_payments exists in schema', () => {
    expect(servicePayments).toBeDefined();
  });

  it('service_payments has orgId column', () => {
    const cols = getTableColumns(servicePayments);
    expect(Object.keys(cols)).toContain('orgId');
  });

  it('service_payments has propertyId column', () => {
    const cols = getTableColumns(servicePayments);
    expect(Object.keys(cols)).toContain('propertyId');
  });
});
