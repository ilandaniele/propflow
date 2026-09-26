/**
 * Real-SQL smoke test for src/lib/leads/listing-alerts.ts's runListingAlertScan
 * matching query path (recent published listings x cold demand leads,
 * claimed via lead_listing_alerts' UNIQUE(lead_id, listing_id)).
 * sendVisitMessage is mocked — it hits a real WhatsApp provider, which is
 * out of scope for a SQL smoke test.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { createSmokeDb, seedOrg, seedAgentConfig, seedLead, seedListing, seedProperty, type SmokeDb } from './setup';

const dbBox = vi.hoisted(() => ({ current: undefined as unknown }));
vi.mock('@/lib/db', () => ({
  get db() {
    return dbBox.current;
  },
}));

const sendVisitMessage = vi.hoisted(() => vi.fn(async () => ({ success: true })));
vi.mock('@/lib/agent/visits/messaging', () => ({ sendVisitMessage }));

let smoke: { db: SmokeDb; close: () => Promise<void> };

beforeAll(async () => {
  smoke = await createSmokeDb();
  dbBox.current = smoke.db;
});

afterAll(async () => {
  await smoke.close();
});

describe('listing-alerts (real SQL)', () => {
  it('matches a cold demand lead to a recently-published listing and claims it once', async () => {
    const { db } = await import('@/lib/db');
    const { runListingAlertScan } = await import('@/lib/leads/listing-alerts');
    const typedDb = db as unknown as SmokeDb;

    const org = await seedOrg(typedDb);
    // sendWindow defaults to a wide range in parseFollowupPolicy — set the
    // whole day explicitly so the test isn't sensitive to `now`'s local hour.
    await seedAgentConfig(typedDb, org.id, {
      channelsEnabled: { whatsapp: true, web: false, voice: false },
      timezone: 'UTC',
      followupPolicy: {
        listingAlerts: { enabled: true, coldAfterDays: 7, minDaysBetween: 14, maxPerOrgPerRun: 10, template: 'listing_alert' },
        sendWindow: { startMinute: 0, endMinute: 1439 },
      },
    });

    const now = new Date('2024-06-15T12:00:00Z');
    const lead = await seedLead(typedDb, org.id, {
      pipeline: 'demand',
      stage: 'new',
      doNotContact: false,
      phone: '+51987654321',
      intentTag: 'cold',
      operationType: 'rent',
      zones: [],
      followupState: 'idle',
    });
    const property = await seedProperty(typedDb, org.id);
    const listing = await seedListing(typedDb, org.id, {
      propertyId: property.id,
      operation: 'rent',
      published: true,
      status: 'available',
      publishedAt: new Date(now.getTime() - 2 * 3_600_000), // 2h ago — inside the 26h lookback
      price: '1500',
      title: 'Depa moderno',
    });
    // Published too long ago — must not match.
    await seedListing(typedDb, org.id, {
      propertyId: property.id,
      operation: 'rent',
      published: true,
      status: 'available',
      publishedAt: new Date(now.getTime() - 48 * 3_600_000),
      price: '1500',
      title: 'Depa viejo',
    });

    const result = await runListingAlertScan(now);

    expect(result.sent).toBe(1);
    expect(result.skipped).toBe(0);
    expect(sendVisitMessage).toHaveBeenCalledTimes(1);
    expect(sendVisitMessage).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: org.id, phone: '+51987654321', meta: expect.objectContaining({ leadId: lead.id, listingId: listing.id }) }),
    );

    // A second run must not double-send — lead_listing_alerts' UNIQUE(lead_id, listing_id)
    // claims it, and lastListingAlertAt/minDaysBetween now also excludes the lead.
    const second = await runListingAlertScan(now);
    expect(second.sent).toBe(0);
  });
});
