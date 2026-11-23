import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import * as schema from '@/lib/db/schema';
import { createSmokeDb, seedOrg, seedProfile, type SmokeDb } from './setup';

const dbBox = vi.hoisted(() => ({ current: undefined as unknown }));
vi.mock('@/lib/db', () => ({
  get db() {
    return dbBox.current;
  },
}));

let smoke: { db: SmokeDb; close: () => Promise<void> };

beforeAll(async () => {
  smoke = await createSmokeDb();
  dbBox.current = smoke.db;
});

afterAll(async () => {
  await smoke.close();
});

async function seedUserWithHome(orgId: string, role: 'admin' | 'tenant' = 'admin') {
  const email = `U-${crypto.randomUUID()}@Example.com`;
  const [user] = await smoke.db.insert(schema.users).values({ id: crypto.randomUUID(), email }).returning();
  await seedProfile(smoke.db, orgId, { userId: user.id, role, email });
  return user;
}

describe('org memberships (real SQL)', () => {
  it('lists the home community first, then memberships, without duplicates', async () => {
    const q = await import('@/lib/memberships/queries');
    const home = await seedOrg(smoke.db, { name: 'Home' });
    const beta = await seedOrg(smoke.db, { name: 'Beta' });
    const alpha = await seedOrg(smoke.db, { name: 'Alpha' });
    const user = await seedUserWithHome(home.id);

    await q.insertMembership({ userId: user.id, orgId: beta.id, role: 'tenant' });
    await q.insertMembership({ userId: user.id, orgId: alpha.id, role: 'admin' });
    await q.insertMembership({ userId: user.id, orgId: home.id, role: 'tenant' });

    expect(await q.listUserCommunities(user.id)).toEqual([
      { orgId: home.id, name: 'Home', role: 'admin' },
      { orgId: alpha.id, name: 'Alpha', role: 'admin' },
      { orgId: beta.id, name: 'Beta', role: 'tenant' },
    ]);
    expect(await q.findMembership(user.id, beta.id)).toEqual({ orgId: beta.id, role: 'tenant' });
    expect(await q.findMembership(user.id, crypto.randomUUID())).toBeNull();
  });

  it('rejects duplicate memberships and invalid roles', async () => {
    const q = await import('@/lib/memberships/queries');
    const home = await seedOrg(smoke.db);
    const other = await seedOrg(smoke.db);
    const user = await seedUserWithHome(home.id);
    await q.insertMembership({ userId: user.id, orgId: other.id, role: 'admin' });

    await expect(q.insertMembership({ userId: user.id, orgId: other.id, role: 'tenant' })).rejects.toThrow();
    await expect(smoke.db.insert(schema.orgMemberships).values({ id: crypto.randomUUID(), userId: user.id, orgId: home.id, role: 'owner' }))
      .rejects.toThrow();
  });

  it('finds users by email case-insensitively with their home org', async () => {
    const q = await import('@/lib/memberships/queries');
    const home = await seedOrg(smoke.db);
    const user = await seedUserWithHome(home.id);

    expect(await q.findUserByEmail(user.email!.toLowerCase())).toEqual({ id: user.id, homeOrgId: home.id });
    expect(await q.findUserByEmail('nobody@example.com')).toBeNull();
  });

  it('lists and deletes members only within the org', async () => {
    const q = await import('@/lib/memberships/queries');
    const home = await seedOrg(smoke.db);
    const org = await seedOrg(smoke.db);
    const other = await seedOrg(smoke.db);
    const user = await seedUserWithHome(home.id);
    await q.insertMembership({ userId: user.id, orgId: org.id, role: 'admin' });

    const [member] = await q.listOrgMembers(org.id);
    expect(member).toMatchObject({ role: 'admin', email: user.email });
    expect(await q.listOrgMembers(other.id)).toHaveLength(0);

    expect(await q.deleteMembership(other.id, member.id)).toBe(false);
    expect(await q.deleteMembership(org.id, member.id)).toBe(true);
    expect(await q.listOrgMembers(org.id)).toHaveLength(0);
  });
});
