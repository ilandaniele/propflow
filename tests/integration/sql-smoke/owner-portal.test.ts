import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import * as schema from '@/lib/db/schema';
import { sha256 } from '@/lib/crypto/hash';
import { createSmokeDb, seedOrg, seedProperty, type SmokeHandle } from './setup';

const dbBox = vi.hoisted(() => ({ current: undefined as unknown }));
const auth = vi.hoisted(() => ({ orgId: '', fail: false }));
vi.mock('@/lib/db', () => ({
  get db() {
    return dbBox.current;
  },
}));
vi.mock('@/lib/auth/guards', () => ({
  requireAdmin: vi.fn(async () => {
    if (auth.fail) throw new Error('unauthorized');
    return { userId: 'user-1', orgId: auth.orgId, role: 'admin', profile: {} };
  }),
}));
vi.mock('@/lib/ratelimit', () => ({ mutationRateLimit: vi.fn(() => ({ success: true })) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/log', () => ({ log: { adminAction: vi.fn() } }));

let smoke: SmokeHandle;

beforeAll(async () => {
  smoke = await createSmokeDb();
  dbBox.current = smoke.db;
});

afterAll(async () => {
  await smoke.close();
});

function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

async function seedOwnerWithIncome(name: string, amount: string) {
  const db = smoke.db;
  const org = await seedOrg(db);
  const property = await seedProperty(db, org.id, { name: `${name} house` });
  const [owner] = await db.insert(schema.owners).values({ orgId: org.id, name }).returning();
  const [unit] = await db.insert(schema.units).values({ orgId: org.id, propertyId: property.id, label: 'U1', status: 'occupied' }).returning();
  const [tenant] = await db.insert(schema.tenants).values({ orgId: org.id, fullName: 'Tenant' }).returning();
  const [contract] = await db.insert(schema.contracts)
    .values({ orgId: org.id, tenantId: tenant.id, unitId: unit.id, startDate: '2026-01-01', monthlyRent: amount })
    .returning();
  await db.insert(schema.payments).values({ orgId: org.id, contractId: contract.id, tenantId: tenant.id, amount, paidAt: '2026-03-05', status: 'approved' });
  await db.insert(schema.propertyOwnerTerms).values({ orgId: org.id, propertyId: property.id, ownerId: owner.id, commissionPct: '10.00' });
  return { org, owner };
}

const tokenFrom = (url: string) => url.split('/owner/')[1];

describe('owner portal links (real SQL)', () => {
  it('creates a hashed link that resolves to the owner and shows only their settlement', async () => {
    const { org, owner } = await seedOwnerWithIncome('Ana', '1000.00');
    const other = await seedOwnerWithIncome('Beto', '5000.00');
    auth.orgId = org.id;
    const { createOwnerPortalLinkAction } = await import('@/app/actions/owner-portal');
    const { resolveOwnerPortalLink } = await import('@/lib/owner-portal/queries');
    const { ownerSettlements } = await import('@/lib/finance/owner-settlement-query');

    const result = await createOwnerPortalLinkAction(null, form({ owner_id: owner.id }));
    expect(result.error).toBeUndefined();
    const token = tokenFrom(result.data!.url);

    const [stored] = await smoke.db.select().from(schema.ownerPortalLinks).where(eq(schema.ownerPortalLinks.ownerId, owner.id));
    expect(stored.tokenHash).toBe(sha256(token));
    expect(stored.tokenHash).not.toContain(token);

    const link = await resolveOwnerPortalLink(token);
    expect(link).toMatchObject({ orgId: org.id, ownerId: owner.id, ownerName: 'Ana' });
    const settlements = await ownerSettlements(link!.orgId, { month: '2026-03', ownerId: link!.ownerId });
    expect(settlements).toHaveLength(1);
    expect(settlements[0].totals['PEN']?.net).toBe(900);
    expect(settlements[0].lines.every((line) => line.propertyName === 'Ana house')).toBe(true);

    const [viewed] = await smoke.db.select().from(schema.ownerPortalLinks).where(eq(schema.ownerPortalLinks.id, stored.id));
    expect(viewed.lastViewedAt).not.toBeNull();

    expect((await createOwnerPortalLinkAction(null, form({ owner_id: other.owner.id }))).error?.code).toBe('NOT_FOUND');
  });

  it('rejects unknown, revoked, replaced and expired tokens', async () => {
    const { org, owner } = await seedOwnerWithIncome('Carla', '800.00');
    auth.orgId = org.id;
    const { createOwnerPortalLinkAction, revokeOwnerPortalLinkAction } = await import('@/app/actions/owner-portal');
    const { resolveOwnerPortalLink, listOwnerPortalLinks } = await import('@/lib/owner-portal/queries');

    expect(await resolveOwnerPortalLink('not-a-real-token')).toBeNull();

    const first = tokenFrom((await createOwnerPortalLinkAction(null, form({ owner_id: owner.id }))).data!.url);
    const second = tokenFrom((await createOwnerPortalLinkAction(null, form({ owner_id: owner.id }))).data!.url);
    expect(await resolveOwnerPortalLink(first)).toBeNull();
    expect(await resolveOwnerPortalLink(second)).not.toBeNull();

    const active = await listOwnerPortalLinks(org.id);
    expect(active).toHaveLength(1);
    expect((await revokeOwnerPortalLinkAction(form({ link_id: active[0].id }))).error).toBeUndefined();
    expect(await resolveOwnerPortalLink(second)).toBeNull();
    expect(await listOwnerPortalLinks(org.id)).toHaveLength(0);

    const third = tokenFrom((await createOwnerPortalLinkAction(null, form({ owner_id: owner.id }))).data!.url);
    await smoke.db.update(schema.ownerPortalLinks).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(schema.ownerPortalLinks.tokenHash, sha256(third)));
    expect(await resolveOwnerPortalLink(third)).toBeNull();
  });

  it('keeps revocation org-scoped and requires an admin', async () => {
    const mine = await seedOwnerWithIncome('Dora', '700.00');
    const theirs = await seedOwnerWithIncome('Eli', '700.00');
    const { createOwnerPortalLinkAction, revokeOwnerPortalLinkAction } = await import('@/app/actions/owner-portal');
    const { resolveOwnerPortalLink, listOwnerPortalLinks } = await import('@/lib/owner-portal/queries');

    auth.orgId = theirs.org.id;
    const theirToken = tokenFrom((await createOwnerPortalLinkAction(null, form({ owner_id: theirs.owner.id }))).data!.url);
    const [theirLink] = await listOwnerPortalLinks(theirs.org.id);

    auth.orgId = mine.org.id;
    expect(await listOwnerPortalLinks(mine.org.id)).toHaveLength(0);
    expect((await revokeOwnerPortalLinkAction(form({ link_id: theirLink.id }))).error?.code).toBe('NOT_FOUND');
    expect(await resolveOwnerPortalLink(theirToken)).not.toBeNull();

    auth.fail = true;
    expect((await createOwnerPortalLinkAction(null, form({ owner_id: mine.owner.id }))).error?.code).toBe('UNAUTHORIZED');
    expect((await revokeOwnerPortalLinkAction(form({ link_id: theirLink.id }))).error?.code).toBe('UNAUTHORIZED');
    auth.fail = false;
  });
});
