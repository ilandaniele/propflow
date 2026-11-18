import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import * as schema from '@/lib/db/schema';
import { createSmokeDb, seedListing, seedOrg, seedProperty, type SmokeHandle } from './setup';

let smoke: SmokeHandle;

beforeAll(async () => {
  smoke = await createSmokeDb();
});

afterAll(async () => {
  await smoke?.close();
});

async function publishedAtOf(id: string) {
  const [row] = await smoke.db.select({ publishedAt: schema.listings.publishedAt }).from(schema.listings).where(eq(schema.listings.id, id));
  return row.publishedAt;
}

describe('listings published_at insert trigger', () => {
  it('keeps an explicit published_at, as the D1 import inserts it', async () => {
    const org = await seedOrg(smoke.db);
    const property = await seedProperty(smoke.db, org.id);
    const importedAt = new Date('2025-03-01T12:00:00Z');
    const listing = await seedListing(smoke.db, org.id, { propertyId: property.id, operation: 'rent', published: true, publishedAt: importedAt });
    expect((await publishedAtOf(listing.id))?.getTime()).toBe(importedAt.getTime());
  });

  it('stamps published_at when a published listing is inserted without one', async () => {
    const org = await seedOrg(smoke.db);
    const property = await seedProperty(smoke.db, org.id);
    const before = Date.now();
    const listing = await seedListing(smoke.db, org.id, { propertyId: property.id, operation: 'rent', published: true });
    expect((await publishedAtOf(listing.id))?.getTime()).toBeGreaterThanOrEqual(before - 1000);
  });
});
