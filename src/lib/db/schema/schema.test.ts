import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';

const MIGRATIONS_DIR = join(__dirname, '..', 'migrations-d1');
const NOW = Date.now();
const HOUR = 3_600_000;

function migratedDb() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    for (const stmt of readFileSync(join(MIGRATIONS_DIR, file), 'utf8').split('--> statement-breakpoint')) {
      if (stmt.replace(/--[^\n]*/g, '').trim()) db.exec(stmt);
    }
  }
  return db;
}

function seedOrgProfileLead(db: DatabaseSync) {
  db.prepare('INSERT INTO organizations (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)').run('org1', 'Org', NOW, NOW);
  db.prepare('INSERT INTO users (id) VALUES (?)').run('user1');
  db.prepare('INSERT INTO profiles (id, user_id, org_id, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run('prof1', 'user1', 'org1', 'admin', NOW, NOW);
  db.prepare('INSERT INTO crm_leads (id, org_id, full_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
    .run('lead1', 'org1', 'Lead', NOW, NOW);
}

function insertVisit(db: DatabaseSync, id: string, startsAt: number, status = 'scheduled') {
  db.prepare(
    `INSERT INTO property_visits
       (id, org_id, lead_id, profile_id, starts_at, ends_at, blocked_until, status, created_by, source_channel, created_at, updated_at)
     VALUES (?, 'org1', 'lead1', 'prof1', ?, ?, ?, ?, 'agent', 'whatsapp', ?, ?)`,
  ).run(id, startsAt, startsAt + HOUR, startsAt + 2 * HOUR, status, NOW, NOW);
}

describe('D1 schema migrations', () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = migratedDb();
  });

  it('creates the key tables and the tenant_statement view', () => {
    const names = (type: string) =>
      (db.prepare('SELECT name FROM sqlite_master WHERE type = ?').all(type) as { name: string }[]).map((r) => r.name);
    expect(names('table')).toEqual(
      expect.arrayContaining(['organizations', 'tenants', 'payments', 'property_visits', 'listings', 'rate_limits']),
    );
    expect(names('view')).toContain('tenant_statement');
    expect(db.prepare('PRAGMA foreign_key_check').all()).toHaveLength(0);
  });

  it('rejects rows that violate a CHECK constraint', () => {
    db.prepare('INSERT INTO organizations (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)').run('org1', 'Org', NOW, NOW);
    db.prepare('INSERT INTO properties (id, org_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run('p1', 'org1', 'P', NOW, NOW);
    const insertUnit = db.prepare(
      'INSERT INTO units (id, org_id, property_id, label, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    );
    expect(() => insertUnit.run('u1', 'org1', 'p1', 'A', 'bogus', NOW, NOW)).toThrow(/units_status_check/);
    expect(() => insertUnit.run('u2', 'org1', 'p1', 'B', 'vacant', NOW, NOW)).not.toThrow();
  });

  it('aborts overlapping active visits with visit_overlap', () => {
    seedOrgProfileLead(db);
    insertVisit(db, 'v1', NOW);
    expect(() => insertVisit(db, 'v2', NOW + HOUR)).toThrow(/visit_overlap/);
    expect(() => insertVisit(db, 'v3', NOW + HOUR, 'cancelled')).not.toThrow();
    expect(() => insertVisit(db, 'v4', NOW + 2 * HOUR)).not.toThrow();
    expect(() => db.prepare('UPDATE property_visits SET status = ? WHERE id = ?').run('scheduled', 'v3')).toThrow(/visit_overlap/);
  });
});
