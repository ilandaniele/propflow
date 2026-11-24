import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import * as schema from '@/lib/db/schema';
import { createSmokeDb, seedLead, seedOrg, seedProperty, type SmokeDb } from './setup';

const dbBox = vi.hoisted(() => ({ current: undefined as unknown }));
vi.mock('@/lib/db', () => ({
  get db() {
    return dbBox.current;
  },
}));

const { globalSearch, SEARCH_LIMIT_PER_KIND } = await import('@/lib/search/global');

let smoke: { db: SmokeDb; close: () => Promise<void> };

beforeAll(async () => {
  smoke = await createSmokeDb();
  dbBox.current = smoke.db;
});

afterAll(async () => {
  await smoke.close();
});

describe('globalSearch', () => {
  it('finds every entity kind, case-insensitively, scoped to the org', async () => {
    const { db } = smoke;
    const org = await seedOrg(db);
    const other = await seedOrg(db, { name: 'Other' });
    const property = await seedProperty(db, org.id, { name: 'Torre Zafiro', address: 'Av. Larco 100' });
    const [unit] = await db.insert(schema.units).values({ orgId: org.id, propertyId: property.id, label: 'Zafiro 301' }).returning();
    await db.insert(schema.tenants).values({ orgId: org.id, fullName: 'Ana Zafiro', documentNumber: '12345678' });
    await db.insert(schema.incidents).values({ orgId: org.id, unitId: unit.id, category: 'plumbing', title: 'Fuga zafiro', description: 'x' });
    await seedLead(db, org.id, { fullName: 'Lead Zafiro' });
    await seedProperty(db, other.id, { name: 'Zafiro ajeno' });

    const hits = await globalSearch(org.id, 'ZAFIRO');
    expect(hits.map((h) => h.kind).sort()).toEqual(['incident', 'lead', 'property', 'tenant', 'unit']);
    expect(hits.find((h) => h.kind === 'unit')?.subtitle).toBe('Torre Zafiro');
    expect(hits.some((h) => h.title === 'Zafiro ajeno')).toBe(false);

    expect((await globalSearch(org.id, '345678')).map((h) => h.title)).toEqual(['Ana Zafiro']);
    expect((await globalSearch(org.id, 'larco')).map((h) => h.kind)).toEqual(['property']);
  });

  it('treats LIKE wildcards literally and caps results per kind', async () => {
    const { db } = smoke;
    const org = await seedOrg(db);
    for (let i = 0; i < SEARCH_LIMIT_PER_KIND + 3; i++) {
      await db.insert(schema.tenants).values({ orgId: org.id, fullName: `Bulk ${i}` });
    }

    expect(await globalSearch(org.id, '%_')).toHaveLength(0);
    expect(await globalSearch(org.id, 'bulk')).toHaveLength(SEARCH_LIMIT_PER_KIND);
  });
});
