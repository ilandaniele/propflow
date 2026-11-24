/**
 * Real-SQL smoke test for tenant email preferences (V19): defaults when no row
 * exists, opt-out persistence, org scoping of the upsert, and the reminder
 * engine skipping an opted-out tenant. sendEmail is mocked: no real email.
 */

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { and, eq } from 'drizzle-orm';
import * as schema from '@/lib/db/schema';
import { createSmokeDb, seedOrg, seedProfile, seedProperty, type SmokeDb } from './setup';

const dbBox = vi.hoisted(() => ({ current: undefined as unknown }));
vi.mock('@/lib/db', () => ({
  get db() {
    return dbBox.current;
  },
}));

const sendEmailMock = vi.hoisted(() => vi.fn(async () => ({ success: true })));
vi.mock('@/lib/notifications/email', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/notifications/email')>()),
  sendEmail: sendEmailMock,
}));

let smoke: { db: SmokeDb; close: () => Promise<void> };

beforeAll(async () => {
  smoke = await createSmokeDb();
  dbBox.current = smoke.db;
});

afterAll(async () => {
  await smoke.close();
});

beforeEach(() => {
  sendEmailMock.mockClear();
});

async function seedTenantProfile(db: SmokeDb, orgId: string, email: string) {
  const profile = await seedProfile(db, orgId, { role: 'tenant', email });
  return profile;
}

describe('email preferences (real SQL)', () => {
  it('defaults every category to on when the profile has no row', async () => {
    const { getEmailPreferences, loadEmailOptOuts } = await import('@/lib/notifications/preferences');
    const org = await seedOrg(smoke.db);
    const profile = await seedTenantProfile(smoke.db, org.id, 'default@example.com');

    expect(await getEmailPreferences(org.id, profile.id)).toEqual({ lease_renewal: true, payment_due: true });
    expect((await loadEmailOptOuts(org.id, 'lease_renewal')).size).toBe(0);
  });

  it('persists an opt-out and lists it per category', async () => {
    const { getEmailPreferences, saveEmailPreferences, loadEmailOptOuts } = await import('@/lib/notifications/preferences');
    const org = await seedOrg(smoke.db);
    const profile = await seedTenantProfile(smoke.db, org.id, 'optout@example.com');

    await saveEmailPreferences(org.id, profile.id, { lease_renewal: false, payment_due: true });
    expect(await getEmailPreferences(org.id, profile.id)).toEqual({ lease_renewal: false, payment_due: true });
    expect(await loadEmailOptOuts(org.id, 'lease_renewal')).toEqual(new Set([profile.id]));
    expect((await loadEmailOptOuts(org.id, 'payment_due')).size).toBe(0);

    await saveEmailPreferences(org.id, profile.id, { lease_renewal: true, payment_due: false });
    expect(await getEmailPreferences(org.id, profile.id)).toEqual({ lease_renewal: true, payment_due: false });
  });

  it("cannot edit or read another org's profile preferences", async () => {
    const { getEmailPreferences, saveEmailPreferences, loadEmailOptOuts } = await import('@/lib/notifications/preferences');
    const orgA = await seedOrg(smoke.db);
    const orgB = await seedOrg(smoke.db);
    const victim = await seedTenantProfile(smoke.db, orgA.id, 'victim@example.com');

    await saveEmailPreferences(orgA.id, victim.id, { lease_renewal: false, payment_due: false });
    await saveEmailPreferences(orgB.id, victim.id, { lease_renewal: true, payment_due: true });

    expect(await getEmailPreferences(orgA.id, victim.id)).toEqual({ lease_renewal: false, payment_due: false });
    expect(await getEmailPreferences(orgB.id, victim.id)).toEqual({ lease_renewal: true, payment_due: true });
    expect((await loadEmailOptOuts(orgB.id, 'lease_renewal')).size).toBe(0);
  });

  it('refuses a first save that pairs a profile with a foreign org', async () => {
    const { getEmailPreferences, saveEmailPreferences } = await import('@/lib/notifications/preferences');
    const orgA = await seedOrg(smoke.db);
    const orgB = await seedOrg(smoke.db);
    const victim = await seedTenantProfile(smoke.db, orgA.id, 'fresh@example.com');

    await saveEmailPreferences(orgB.id, victim.id, { lease_renewal: false, payment_due: false });

    const rows = await smoke.db.select().from(schema.notificationPreferences).where(eq(schema.notificationPreferences.profileId, victim.id));
    expect(rows).toEqual([]);
    expect(await getEmailPreferences(orgA.id, victim.id)).toEqual({ lease_renewal: true, payment_due: true });
  });
});

describe('runReminderEngine honours email opt-outs (real SQL)', () => {
  it('skips the email for an opted-out tenant, keeps the in-app notice, and still emails everyone else', async () => {
    const { saveEmailPreferences } = await import('@/lib/notifications/preferences');
    const { runReminderEngine, todayStr, addDays } = await import('@/lib/notifications/reminder-engine');
    const db = smoke.db;
    const org = await seedOrg(db);
    const property = await seedProperty(db, org.id);
    const today = todayStr();

    async function seedResident(email: string) {
      const profile = await seedTenantProfile(db, org.id, email);
      const [unit] = await db.insert(schema.units).values({ orgId: org.id, propertyId: property.id, label: email }).returning();
      const [tenant] = await db.insert(schema.tenants).values({ orgId: org.id, fullName: email, email, profileId: profile.id, unitId: unit.id }).returning();
      const [contract] = await db.insert(schema.contracts)
        .values({ orgId: org.id, tenantId: tenant.id, unitId: unit.id, startDate: '2026-01-01', endDate: addDays(today, 10), monthlyRent: '800.00', status: 'active' })
        .returning();
      await db.insert(schema.charges).values({ orgId: org.id, contractId: contract.id, tenantId: tenant.id, amount: '800.00', dueDate: today });
      return { profile, contract };
    }

    const optedOut = await seedResident('opted-out@example.com');
    await seedResident('opted-in@example.com');
    await saveEmailPreferences(org.id, optedOut.profile.id, { lease_renewal: false, payment_due: false });

    await runReminderEngine('https://propflow.test');

    const recipients = (sendEmailMock.mock.calls as unknown as Array<[{ to: string; context: string }]>)
      .map(([opts]) => `${opts.to}:${opts.context}`)
      .sort();
    expect(recipients).toContain('opted-in@example.com:lease_renewal');
    expect(recipients).toContain('opted-in@example.com:payment_due');
    expect(recipients.filter((r) => r.startsWith('opted-out@example.com'))).toEqual([]);

    const [skipped] = await db.select({ status: schema.reminders.status, channel: schema.reminders.channel })
      .from(schema.reminders)
      .where(and(eq(schema.reminders.orgId, org.id), eq(schema.reminders.targetId, optedOut.contract.id)));
    expect(skipped).toEqual({ status: 'skipped', channel: 'in_app' });

    const inbox = await db.select({ type: schema.notificationInbox.type })
      .from(schema.notificationInbox)
      .where(eq(schema.notificationInbox.profileId, optedOut.profile.id));
    expect(inbox.map((i) => i.type).sort()).toEqual(['lease_renewal', 'payment_due']);
  });
});
