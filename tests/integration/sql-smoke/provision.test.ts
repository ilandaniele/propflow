/**
 * Real-SQL smoke test for src/lib/auth/provision.ts's provisionOrgAndProfile
 * — org + admin profile inserts, formerly an insert with a compensating
 * delete, now one D1 batch (W-CF-32). A failed profile insert must leave no
 * org row behind.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { createSmokeDb, type SmokeDb } from './setup';
import * as schema from '@/lib/db/schema';

const dbBox = vi.hoisted(() => ({ current: undefined as unknown }));
vi.mock('@/lib/db', () => ({
  get db() {
    return dbBox.current;
  },
}));
vi.mock('@/lib/log', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

let smoke: { db: SmokeDb; close: () => Promise<void> };

beforeAll(async () => {
  smoke = await createSmokeDb();
  dbBox.current = smoke.db;
});

afterAll(async () => {
  await smoke.close();
});

describe('provisionOrgAndProfile (real SQL)', () => {
  it('creates org + admin profile together, and rolls the org back when the profile insert fails', async () => {
    const { provisionOrgAndProfile } = await import('@/lib/auth/provision');
    const [user] = await smoke.db.insert(schema.users)
      .values({ id: crypto.randomUUID(), email: 'owner@example.com' }).returning();

    const result = await provisionOrgAndProfile(user.id, 'owner@example.com', 'Acme Rentals', 'Owner');
    const [profile] = await smoke.db.select().from(schema.profiles).where(eq(schema.profiles.id, result.profileId));
    expect(profile).toMatchObject({ userId: user.id, orgId: result.orgId, role: 'admin' });

    await expect(provisionOrgAndProfile(user.id, 'owner@example.com', 'Second Org'))
      .rejects.toThrow(/PROVISION_FAILED:profile/);
    expect(await smoke.db.select().from(schema.organizations).where(eq(schema.organizations.slug, 'second-org')))
      .toHaveLength(0);
  });
});
