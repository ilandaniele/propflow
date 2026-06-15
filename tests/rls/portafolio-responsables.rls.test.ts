/**
 * tests/rls/portafolio-responsables.rls.test.ts
 *
 * Static migration SQL tests for Portafolio and Responsables migrations.
 * No live DB required — reads and parses migration files.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const REPO_ROOT = path.resolve(__dirname, '../../');

function readMigration(filename: string): string {
  const filePath = path.join(REPO_ROOT, 'supabase', 'migrations', filename);
  return fs.readFileSync(filePath, 'utf8');
}

// ---------------------------------------------------------------------------
// Migration 000040 — units airtable columns + partial unique index
// ---------------------------------------------------------------------------

describe('Migration 000040 — units airtable columns', () => {
  let sql: string;

  try {
    sql = readMigration('20260609000040_units_airtable.sql');
  } catch {
    sql = '';
  }

  it('units has ADD COLUMN IF NOT EXISTS airtable_external_id', () => {
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS airtable_external_id');
  });

  it('units has ADD COLUMN IF NOT EXISTS airtable_synced_at', () => {
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS airtable_synced_at');
  });

  it('units has ADD COLUMN IF NOT EXISTS area_m2', () => {
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS area_m2');
  });

  it('partial unique index units_org_airtable_ext_id_uidx exists in migration', () => {
    expect(sql).toContain('units_org_airtable_ext_id_uidx');
    expect(sql).toContain('WHERE airtable_external_id IS NOT NULL');
  });

  it('index is created on (org_id, airtable_external_id)', () => {
    expect(sql).toContain('ON units (org_id, airtable_external_id)');
  });
});

// ---------------------------------------------------------------------------
// Migration 000041 — responsables table with RLS
// ---------------------------------------------------------------------------

describe('Migration 000041 — responsables table creation + RLS', () => {
  let sql: string;

  try {
    sql = readMigration('20260609000041_responsables_table.sql');
  } catch {
    sql = '';
  }

  it('responsables table is created with org_id column', () => {
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS responsables');
    expect(sql).toContain('org_id');
  });

  it('responsables table has airtable_external_id column', () => {
    expect(sql).toContain('airtable_external_id');
  });

  it('partial unique index responsables_org_airtable_ext_id_uidx exists', () => {
    expect(sql).toContain('responsables_org_airtable_ext_id_uidx');
    expect(sql).toContain('WHERE airtable_external_id IS NOT NULL');
  });

  it('RLS is enabled on responsables table', () => {
    expect(sql).toContain('ALTER TABLE responsables ENABLE ROW LEVEL SECURITY');
  });

  it('SELECT RLS policy for org members exists', () => {
    expect(sql).toContain('org members can read their responsables');
    expect(sql).toContain('FOR SELECT');
  });

  it('service_role ALL policy exists', () => {
    expect(sql).toContain('service role can manage responsables');
    expect(sql).toContain('FOR ALL');
    expect(sql).toContain("auth.role() = 'service_role'");
  });

  it('WITH CHECK clause present on service_role policy', () => {
    expect(sql).toContain('WITH CHECK');
  });

  it('responsables table references organizations via org_id FK', () => {
    expect(sql).toContain('REFERENCES organizations(id)');
  });
});

// ---------------------------------------------------------------------------
// Migration 000042 — tenants responsable_id FK
// ---------------------------------------------------------------------------

describe('Migration 000042 — tenants.responsable_id FK column', () => {
  let sql: string;

  try {
    sql = readMigration('20260609000042_tenants_responsable_fk.sql');
  } catch {
    sql = '';
  }

  it('tenants has ADD COLUMN IF NOT EXISTS responsable_id', () => {
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS responsable_id');
  });

  it('responsable_id is a UUID column', () => {
    expect(sql).toContain('UUID');
  });

  it('responsable_id references responsables(id)', () => {
    expect(sql).toContain('REFERENCES responsables(id)');
  });

  it('FK uses ON DELETE SET NULL (nullable backfill-safe)', () => {
    expect(sql).toContain('ON DELETE SET NULL');
  });
});
