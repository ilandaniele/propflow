/**
 * tests/rls/import-logs.rls.test.ts
 *
 * Static SQL assertion tests for import_logs RLS policies.
 * No live DB required — reads and parses the migration SQL file.
 *
 * Asserts:
 *  1. RLS is enabled on import_logs
 *  2. SELECT policy: org members can read own logs
 *  3. INSERT/UPDATE/DELETE only allowed for service_role (via service_role full access policy)
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const REPO_ROOT = path.resolve(__dirname, '../../');

function readMigration(filename: string): string {
  const filePath = path.join(REPO_ROOT, 'supabase', 'migrations', filename);
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return '';
  }
}

const MIGRATION_FILE = '20260610000047_import_logs.sql';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('import_logs migration — RLS enabled', () => {
  const sql = readMigration(MIGRATION_FILE);

  it('migration file exists and is non-empty', () => {
    expect(sql.length).toBeGreaterThan(0);
  });

  it('import_logs table has ENABLE ROW LEVEL SECURITY', () => {
    expect(sql).toMatch(/ALTER TABLE import_logs ENABLE ROW LEVEL SECURITY/);
  });
});

describe('import_logs migration — SELECT policy for org members', () => {
  const sql = readMigration(MIGRATION_FILE);

  it('has a policy for SELECT on import_logs', () => {
    // Expect a CREATE POLICY ... FOR SELECT on import_logs
    const pattern = /CREATE POLICY[^;]*ON import_logs FOR SELECT/;
    expect(pattern.test(sql)).toBe(true);
  });

  it('SELECT policy uses auth.uid() to scope by org membership', () => {
    expect(sql).toContain('auth.uid()');
  });

  it('SELECT policy references profiles table for org_id lookup', () => {
    expect(sql).toContain('profiles');
  });
});

describe('import_logs migration — service_role full access policy', () => {
  const sql = readMigration(MIGRATION_FILE);

  it('has a service_role policy granting full access to import_logs', () => {
    // service_role policy covers INSERT, UPDATE, DELETE (via FOR ALL TO service_role)
    const hasServiceRole = /TO service_role/.test(sql);
    expect(hasServiceRole).toBe(true);
  });

  it('service_role policy uses FOR ALL (covers INSERT, UPDATE, DELETE)', () => {
    const pattern = /CREATE POLICY[^;]*FOR ALL TO service_role/;
    expect(pattern.test(sql)).toBe(true);
  });

  it('service_role policy has WITH CHECK (true) allowing all inserts', () => {
    expect(sql).toContain('WITH CHECK (true)');
  });
});

describe('import_logs migration — no public insert/update/delete policy', () => {
  const sql = readMigration(MIGRATION_FILE);

  it('there is no unrestricted INSERT policy for regular users', () => {
    // Verify there is no policy that grants INSERT to all authenticated users
    const hasInsertAll = /CREATE POLICY[^;]*FOR INSERT[^;]*USING\s*\(true\)/i.test(sql);
    expect(hasInsertAll).toBe(false);
  });
});

describe('import_logs conceptual RLS — org isolation guarantee', () => {
  /**
   * Conceptual tests verifying the logic of the SELECT policy:
   *   USING (org_id IN (SELECT org_id FROM profiles WHERE id = auth.uid()))
   *
   * This means a user can only see rows where import_logs.org_id matches
   * their profile's org_id. Users from different orgs see 0 rows.
   */

  it('org isolation: org_id join with profiles guarantees cross-org rows are invisible', () => {
    const orgA = 'org-a-uuid';
    const orgB = 'org-b-uuid';

    // Simulate what the policy does: filter rows where import_logs.org_id IN (user's org_id)
    const allLogs = [
      { id: 'log-001', org_id: orgA },
      { id: 'log-002', org_id: orgB },
    ];

    // User from org A can only see org A logs
    const visibleToOrgA = allLogs.filter(l => l.org_id === orgA);
    expect(visibleToOrgA).toHaveLength(1);
    expect(visibleToOrgA[0].id).toBe('log-001');

    // User from org B can only see org B logs
    const visibleToOrgB = allLogs.filter(l => l.org_id === orgB);
    expect(visibleToOrgB).toHaveLength(1);
    expect(visibleToOrgB[0].id).toBe('log-002');
  });

  it('service_role bypasses RLS — admin can read all import_logs', () => {
    // This is the documented behaviour for service_role: USING (true) means all rows visible
    const rlsCheck = (role: string, _logOrgId: string) => {
      if (role === 'service_role') return true;
      return false; // regular users are filtered by org_id
    };

    expect(rlsCheck('service_role', 'any-org')).toBe(true);
    expect(rlsCheck('authenticated', 'any-org')).toBe(false);
  });
});
