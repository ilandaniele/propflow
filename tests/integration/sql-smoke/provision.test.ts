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

describe('email lookups (real SQL)', () => {
  it('resolvePrimaryOrgId matches the owner email ignoring case', async () => {
    const { resolvePrimaryOrgId, provisionOrgAndProfile } = await import('@/lib/auth/provision');
    vi.stubEnv('PRIMARY_OWNER_EMAIL', 'boss@example.com');
    const [user] = await smoke.db.insert(schema.users)
      .values({ id: crypto.randomUUID(), email: 'Boss@Example.com' }).returning();
    const { orgId } = await provisionOrgAndProfile(user.id, 'Boss@Example.com', 'Boss Org');

    expect(await resolvePrimaryOrgId()).toBe(orgId);
    vi.unstubAllEnvs();
  });

  it('attemptAutoLink links a tenant whose email differs only in case, and treats _ literally', async () => {
    const { attemptAutoLink } = await import('@/lib/auth/provision');
    const [org] = await smoke.db.insert(schema.organizations)
      .values({ name: 'Link Org', slug: 'link-org' }).returning();
    await smoke.db.insert(schema.tenants)
      .values({ orgId: org.id, fullName: 'Ana', email: 'Ana.Link@Example.com' });
    await smoke.db.insert(schema.tenants)
      .values({ orgId: org.id, fullName: 'Wild', email: 'wildXcard@example.com' });
    const [user] = await smoke.db.insert(schema.users)
      .values({ id: crypto.randomUUID(), email: 'ana.link@example.com' }).returning();
    const [other] = await smoke.db.insert(schema.users)
      .values({ id: crypto.randomUUID(), email: 'wild_card@example.com' }).returning();

    expect(await attemptAutoLink(user.id, 'ana.link@example.com')).toEqual({ linked: true, orgId: org.id });
    expect(await attemptAutoLink(other.id, 'wild_card@example.com')).toEqual({ linked: false, reason: 'no_match' });
  });
});

describe('profiles.id == users.id invariant (real SQL)', () => {
  async function newUser(email: string) {
    const [user] = await smoke.db.insert(schema.users)
      .values({ id: crypto.randomUUID(), email }).returning();
    return user;
  }

  async function profileOf(userId: string) {
    const [profile] = await smoke.db.select().from(schema.profiles).where(eq(schema.profiles.userId, userId));
    return profile;
  }

  it('provisionOrgAndProfile reuses the user id as profile id', async () => {
    const { provisionOrgAndProfile } = await import('@/lib/auth/provision');
    const user = await newUser('inv-owner@example.com');

    const result = await provisionOrgAndProfile(user.id, user.email!, 'Invariant Org');

    expect(result.profileId).toBe(user.id);
    expect((await profileOf(user.id)).id).toBe(user.id);
  });

  it('attachToPrimaryOrgAsAdmin reuses the user id as profile id', async () => {
    const { attachToPrimaryOrgAsAdmin } = await import('@/lib/auth/provision');
    const user = await newUser('inv-admin@example.com');

    const result = await attachToPrimaryOrgAsAdmin(user.id, user.email!, 'Admin');

    expect(result.profileId).toBe(user.id);
    expect((await profileOf(user.id)).id).toBe(user.id);
  });

  it('attemptAutoLink reuses the user id as profile id and links the tenant to it', async () => {
    const { attemptAutoLink } = await import('@/lib/auth/provision');
    const [org] = await smoke.db.insert(schema.organizations)
      .values({ name: 'Invariant Link Org', slug: 'invariant-link-org' }).returning();
    const [tenant] = await smoke.db.insert(schema.tenants)
      .values({ orgId: org.id, fullName: 'Inv', email: 'inv-tenant@example.com' }).returning();
    const user = await newUser('inv-tenant@example.com');

    expect(await attemptAutoLink(user.id, user.email!)).toEqual({ linked: true, orgId: org.id });

    expect((await profileOf(user.id)).id).toBe(user.id);
    const [linked] = await smoke.db.select().from(schema.tenants).where(eq(schema.tenants.id, tenant.id));
    expect(linked.profileId).toBe(user.id);
  });
});
