/**
 * Migration 0005 re-keys legacy profiles so profiles.id == profiles.user_id,
 * carrying every FK column that points at profiles.id along with it.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createSmokeDb, readMigrations, type SmokeHandle } from './setup';

const MIGRATION_TAG = '0005_profile_id_equals_user_id';
const NOW = Date.now();

let smoke: SmokeHandle;

beforeAll(async () => {
  smoke = await createSmokeDb();
});

afterAll(async () => {
  await smoke.close();
});

async function run(sql: string, ...params: unknown[]) {
  await smoke.d1.prepare(sql).bind(...params).run();
}

async function all<T>(sql: string, ...params: unknown[]): Promise<T[]> {
  return (await smoke.d1.prepare(sql).bind(...params).all<T>()).results;
}

async function applyRekeyMigration() {
  const migration = readMigrations().find((m) => m.tag === MIGRATION_TAG);
  if (!migration) throw new Error(`${MIGRATION_TAG} missing from the journal`);
  await smoke.d1.batch(migration.statements.map((s) => smoke.d1.prepare(s)));
}

describe(`${MIGRATION_TAG} (real SQL)`, () => {
  it('re-keys legacy profiles and their FK references, leaving healthy profiles alone', async () => {
    const legacyUser = crypto.randomUUID();
    const legacyProfile = crypto.randomUUID();
    const healthyUser = crypto.randomUUID();
    const orgId = crypto.randomUUID();
    const tenantId = crypto.randomUUID();

    await run('INSERT INTO users (id) VALUES (?), (?)', legacyUser, healthyUser);
    await run('INSERT INTO organizations (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)', orgId, 'Org', NOW, NOW);
    await run(
      `INSERT INTO profiles (id, user_id, org_id, role, created_at, updated_at)
       VALUES (?, ?, ?, 'admin', ?, ?), (?, ?, ?, 'admin', ?, ?)`,
      legacyProfile, legacyUser, orgId, NOW, NOW,
      healthyUser, healthyUser, orgId, NOW, NOW,
    );
    await run(
      'INSERT INTO tenants (id, org_id, full_name, profile_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      tenantId, orgId, 'Ana', legacyProfile, NOW, NOW,
    );
    await run(
      `INSERT INTO announcements (id, org_id, created_by, title, body, created_at, updated_at)
       VALUES (?, ?, ?, 't', 'b', ?, ?), (?, ?, ?, 't', 'b', ?, ?)`,
      crypto.randomUUID(), orgId, legacyProfile, NOW, NOW,
      crypto.randomUUID(), orgId, healthyUser, NOW, NOW,
    );
    await run(
      'INSERT INTO internal_notes (id, org_id, tenant_id, content, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      crypto.randomUUID(), orgId, tenantId, 'note', legacyProfile, NOW,
    );

    await applyRekeyMigration();

    expect(await all('SELECT id FROM profiles WHERE id <> user_id')).toEqual([]);
    expect(await all('SELECT id FROM profiles WHERE id = ?', legacyProfile)).toEqual([]);
    expect(await all<{ profile_id: string }>('SELECT profile_id FROM tenants WHERE id = ?', tenantId))
      .toEqual([{ profile_id: legacyUser }]);
    expect((await all<{ created_by: string }>('SELECT created_by FROM announcements ORDER BY created_by')).map((r) => r.created_by).sort())
      .toEqual([healthyUser, legacyUser].sort());
    expect(await all<{ created_by: string }>('SELECT created_by FROM internal_notes')).toEqual([{ created_by: legacyUser }]);
    expect(await all('PRAGMA foreign_key_check')).toEqual([]);
  });

  it('is a no-op once every profile already satisfies the invariant', async () => {
    const before = await all('SELECT id, user_id FROM profiles ORDER BY id');
    await applyRekeyMigration();
    expect(await all('SELECT id, user_id FROM profiles ORDER BY id')).toEqual(before);
  });
});
