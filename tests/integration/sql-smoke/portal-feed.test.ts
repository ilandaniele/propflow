import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createSmokeDb, seedAgentConfig, seedListing, seedOrg, seedProperty, type SmokeHandle } from './setup';

let smoke: SmokeHandle;
const { getPublicOrg, listPublicFeedListings } = await import('@/lib/public/catalog');

beforeAll(async () => {
  smoke = await createSmokeDb();
});

afterAll(async () => {
  await smoke?.close();
});

describe('portal XML feed queries', () => {
  it('returns only published + available listings of the org, newest first', async () => {
    const org = await seedOrg(smoke.db, { slug: 'feed-org' });
    const other = await seedOrg(smoke.db, { slug: 'feed-other' });
    const propertyId = (await seedProperty(smoke.db, org.id)).id;
    const otherPropertyId = (await seedProperty(smoke.db, other.id)).id;
    await seedListing(smoke.db, org.id, { propertyId, operation: 'rent', published: true, publicSlug: 'old', refCode: 'R-OLD', createdAt: new Date('2026-01-01') });
    await seedListing(smoke.db, org.id, { propertyId, operation: 'sale', published: true, publicSlug: 'new', description: 'desc', createdAt: new Date('2026-02-01') });
    await seedListing(smoke.db, org.id, { propertyId, operation: 'rent', published: false, publicSlug: 'draft' });
    await seedListing(smoke.db, org.id, { propertyId, operation: 'rent', published: true, publicSlug: 'reserved', status: 'reserved' });
    await seedListing(smoke.db, other.id, { propertyId: otherPropertyId, operation: 'rent', published: true, publicSlug: 'foreign' });

    const rows = await listPublicFeedListings(org.id);

    expect(rows.map((r) => r.slug)).toEqual(['new', 'old']);
    expect(rows[0]).toMatchObject({ operation: 'sale', description: 'desc', refCode: null });
    expect(rows[1].refCode).toBe('R-OLD');
    expect(rows[1].publishedAt).toBeInstanceOf(Date);
  });

  it('hides the org when public pages are disabled', async () => {
    const org = await seedOrg(smoke.db, { slug: 'feed-off' });
    await seedAgentConfig(smoke.db, org.id, { publicPagesEnabled: false });
    expect(await getPublicOrg('feed-off')).toBeNull();
  });

  it('exposes the org when public pages are enabled', async () => {
    const org = await seedOrg(smoke.db, { slug: 'feed-on' });
    await seedAgentConfig(smoke.db, org.id, { publicPagesEnabled: true });
    expect(await getPublicOrg('feed-on')).toMatchObject({ id: org.id, slug: 'feed-on' });
  });
});
