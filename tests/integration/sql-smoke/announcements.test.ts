import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { createSmokeDb, seedOrg, seedProfile, seedProperty, type SmokeDb } from './setup';
import { announcements, units } from '@/lib/db/schema';
import { listTenantAnnouncements, setAnnouncementPinned } from '@/lib/announcements/queries';

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

const NOW = new Date('2026-06-15T12:00:00Z');
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000);

async function seedScenario() {
  const org = await seedOrg(smoke.db);
  const admin = await seedProfile(smoke.db, org.id, { role: 'admin', email: `admin-${crypto.randomUUID()}@example.com` });
  const property = await seedProperty(smoke.db, org.id);
  const otherProperty = await seedProperty(smoke.db, org.id);
  const [unit] = await smoke.db.insert(units).values({ orgId: org.id, propertyId: property.id, label: '101' }).returning();
  const add = async (values: Partial<typeof announcements.$inferInsert> & { title: string }) => {
    const [row] = await smoke.db
      .insert(announcements)
      .values({ orgId: org.id, createdBy: admin.id, body: 'Body', publishedAt: daysAgo(1), ...values })
      .returning({ id: announcements.id });
    return row.id;
  };
  return { org, property, otherProperty, unit, add };
}

describe('announcements (real SQL)', () => {
  it('lists pinned first, then newest published, and hides drafts, future and expired ones', async () => {
    const { org, add } = await seedScenario();
    const old = await add({ title: 'old', publishedAt: daysAgo(10) });
    const recent = await add({ title: 'recent', publishedAt: daysAgo(1) });
    const pinned = await add({ title: 'pinned', publishedAt: daysAgo(20), pinned: true, important: true });
    await add({ title: 'draft', publishedAt: null });
    await add({ title: 'future', publishedAt: new Date(NOW.getTime() + 86_400_000) });
    await add({ title: 'expired', expiresAt: daysAgo(0.5) });

    const list = await listTenantAnnouncements(org.id, { propertyId: null, unitId: null }, NOW);
    expect(list.map((a) => a.id)).toEqual([pinned, recent, old]);
    expect(list[0]).toMatchObject({ pinned: true, important: true });
  });

  it('targets property and unit audiences', async () => {
    const { org, property, otherProperty, unit, add } = await seedScenario();
    const forProperty = await add({ title: 'p', audience: 'property', propertyId: property.id });
    await add({ title: 'other', audience: 'property', propertyId: otherProperty.id });
    const forUnit = await add({ title: 'u', audience: 'unit', unitId: unit.id, publishedAt: daysAgo(2) });

    const resident = await listTenantAnnouncements(org.id, { propertyId: property.id, unitId: unit.id }, NOW);
    expect(resident.map((a) => a.id)).toEqual([forProperty, forUnit]);
    expect(await listTenantAnnouncements(org.id, { propertyId: null, unitId: null }, NOW)).toEqual([]);
  });

  it('toggles the pin only inside the owning org', async () => {
    const { org, add } = await seedScenario();
    const other = await seedOrg(smoke.db);
    const id = await add({ title: 'a' });

    expect(await setAnnouncementPinned(other.id, id, true)).toBe(false);
    expect(await setAnnouncementPinned(org.id, id, true)).toBe(true);
    expect((await listTenantAnnouncements(org.id, { propertyId: null, unitId: null }, NOW))[0].pinned).toBe(true);
    expect(await setAnnouncementPinned(org.id, id, false)).toBe(true);
    expect((await listTenantAnnouncements(org.id, { propertyId: null, unitId: null }, NOW))[0].pinned).toBe(false);
  });
});
