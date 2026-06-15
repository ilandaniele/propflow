/**
 * tests/rls/service-payments.rls.test.ts
 *
 * Static SQL checks — verifies migration 20260609000043_service_payments.sql
 * contains all required DDL: RLS, policies, columns, index.
 *
 * No DB connection required — pure file-content assertions.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const MIGRATION_PATH = resolve(
  __dirname,
  '../../supabase/migrations/20260609000043_service_payments.sql'
);

let migrationSql: string;

try {
  migrationSql = readFileSync(MIGRATION_PATH, 'utf-8');
} catch {
  migrationSql = '';
}

describe('migration 000043 — service_payments', () => {
  it('migration file exists and is non-empty', () => {
    expect(migrationSql.length).toBeGreaterThan(0);
  });

  it('creates service_payments table with IF NOT EXISTS', () => {
    expect(migrationSql).toMatch(/CREATE TABLE IF NOT EXISTS service_payments/i);
  });

  it('has org_id column', () => {
    expect(migrationSql).toMatch(/org_id\s+UUID/i);
  });

  it('has service_type column', () => {
    expect(migrationSql).toMatch(/service_type\s+TEXT/i);
  });

  it('has monthly_data column as JSONB', () => {
    expect(migrationSql).toMatch(/monthly_data\s+JSONB/i);
  });

  it('has tope column', () => {
    expect(migrationSql).toMatch(/tope\s+NUMERIC/i);
  });

  it('has airtable_external_id column', () => {
    expect(migrationSql).toMatch(/airtable_external_id\s+TEXT/i);
  });

  it('enables ROW LEVEL SECURITY', () => {
    expect(migrationSql).toMatch(/ALTER TABLE service_payments ENABLE ROW LEVEL SECURITY/i);
  });

  it('has partial unique index WHERE airtable_external_id IS NOT NULL', () => {
    expect(migrationSql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS service_payments_org_airtable_ext_id_uidx/i);
    expect(migrationSql).toMatch(/WHERE airtable_external_id IS NOT NULL/i);
  });

  it('has org members SELECT policy', () => {
    expect(migrationSql).toMatch(/org members can read their service_payments/i);
    expect(migrationSql).toMatch(/FOR SELECT/i);
    expect(migrationSql).toMatch(/auth\.uid\(\)/i);
  });

  it('has service_role ALL policy with WITH CHECK', () => {
    expect(migrationSql).toMatch(/service role can manage service_payments/i);
    expect(migrationSql).toMatch(/FOR ALL/i);
    expect(migrationSql).toMatch(/WITH CHECK/i);
    expect(migrationSql).toMatch(/auth\.role\(\)\s*=\s*'service_role'/i);
  });
});
