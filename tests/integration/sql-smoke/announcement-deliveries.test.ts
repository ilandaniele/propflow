import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import * as schema from '@/lib/db/schema';
import { createSmokeDb, seedOrg, seedProfile, seedProperty, type SmokeDb } from './setup';

const auth = vi.hoisted(() => ({ ctx: { userId: '', orgId: '', role: 'admin' }, signedIn: true }));
vi.mock('@/lib/auth/guards', () => ({
  requireAdmin: vi.fn(async () => {
    if (!auth.signedIn) throw new Error('UNAUTHORIZED');
    if (auth.ctx.role !== 'admin') throw new Error('FORBIDDEN');
    return auth.ctx;
  }),
  requireUser: vi.fn(async () => auth.ctx),
}));
vi.mock('@/lib/ratelimit', () => ({ mutationRateLimit: vi.fn(() => ({ success: true })) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const senders = vi.hoisted(() => ({
  sendEmail: vi.fn(async (_input: { to: string; subject: string; html: string }) => ({ success: true as boolean, error: undefined as string | undefined })),
  sendTemplate: vi.fn(async (_orgId: string, _input: { to: string; templateName: string; bodyParams: string[] }) => ({ success: true as boolean, error: undefined as string | undefined })),
}));
vi.mock('@/lib/notifications/email', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/notifications/email')>()),
  sendEmail: senders.sendEmail,
}));
vi.mock('@/lib/whatsapp', () => ({ getWhatsAppProvider: () => ({ sendTemplate: senders.sendTemplate }) }));

import { continueAnnouncementDelivery, publishAnnouncement } from '@/app/actions/ops';
import { loadDeliveryCounts, SENDS_PER_RUN } from '@/lib/announcements/delivery';

let smoke: { db: SmokeDb; close: () => Promise<void> };
let db: SmokeDb;

beforeAll(async () => {
  smoke = await createSmokeDb();
  db = smoke.db;
});

afterAll(async () => {
  await smoke.close();
});

beforeEach(() => {
  senders.sendEmail.mockReset();
  senders.sendTemplate.mockReset();
  auth.signedIn = true;
});

function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

type TenantSeed = Partial<typeof schema.tenants.$inferInsert> & { label: string; contractStatus?: string; announcementsEmail?: boolean };

async function seedTenant(orgId: string, propertyId: string, seed: TenantSeed) {
  const profile = await seedProfile(db, orgId, { role: 'tenant', email: `${seed.label}-${crypto.randomUUID()}@example.com` });
  const [unit] = await db.insert(schema.units).values({ orgId, propertyId, label: seed.label }).returning();
  const [tenant] = await db
    .insert(schema.tenants)
    .values({ orgId, fullName: `Tenant ${seed.label}`, unitId: unit.id, profileId: profile.id, email: `${seed.label}@example.com`, ...seed })
    .returning();
  await db.insert(schema.contracts).values({
    orgId, tenantId: tenant.id, unitId: unit.id, startDate: '2026-01-01', monthlyRent: '800.00', status: seed.contractStatus ?? 'active',
  });
  if (seed.announcementsEmail !== undefined) {
    await db.insert(schema.notificationPreferences).values({ orgId, profileId: profile.id, announcementsEmail: seed.announcementsEmail });
  }
  return tenant;
}

async function seedOrgWithAnnouncement(values: Partial<typeof schema.announcements.$inferInsert> = {}) {
  const org = await seedOrg(db);
  const admin = await seedProfile(db, org.id, { email: `admin-${org.id}@example.com` });
  const property = await seedProperty(db, org.id);
  const [ann] = await db
    .insert(schema.announcements)
    .values({ orgId: org.id, createdBy: admin.id, title: 'Corte de agua', body: 'El jueves\nno habrá agua.', ...values })
    .returning();
  auth.ctx = { userId: admin.id, orgId: org.id, role: 'admin' };
  return { org, admin, property, ann };
}

const deliveriesOf = (announcementId: string) =>
  db.select().from(schema.announcementDeliveries).where(eq(schema.announcementDeliveries.announcementId, announcementId));

describe('announcement bulk delivery (real SQL)', () => {
  it('returns 401 when signed out and 403 for non-admins, sending nothing', async () => {
    const { property, ann, org } = await seedOrgWithAnnouncement();
    await seedTenant(org.id, property.id, { label: 'a' });

    auth.signedIn = false;
    expect((await publishAnnouncement({}, form({ id: ann.id, send_email: 'on' }))).error?.code).toBe('UNAUTHORIZED');
    expect((await continueAnnouncementDelivery({}, form({ id: ann.id }))).error?.code).toBe('UNAUTHORIZED');

    auth.signedIn = true;
    auth.ctx = { ...auth.ctx, role: 'tenant' };
    expect((await publishAnnouncement({}, form({ id: ann.id, send_email: 'on' }))).error?.code).toBe('FORBIDDEN');
    expect((await continueAnnouncementDelivery({}, form({ id: ann.id }))).error?.code).toBe('FORBIDDEN');

    expect(senders.sendEmail).not.toHaveBeenCalled();
    expect(await deliveriesOf(ann.id)).toEqual([]);
  });

  it('rejects another org\'s announcement with NOT_FOUND', async () => {
    const { ann, org, property } = await seedOrgWithAnnouncement();
    await seedTenant(org.id, property.id, { label: 'victim' });
    await seedOrgWithAnnouncement();

    expect((await publishAnnouncement({}, form({ id: ann.id, send_email: 'on' }))).error?.code).toBe('NOT_FOUND');
    expect((await continueAnnouncementDelivery({}, form({ id: ann.id }))).error?.code).toBe('NOT_FOUND');
    expect(senders.sendEmail).not.toHaveBeenCalled();
    expect(await deliveriesOf(ann.id)).toEqual([]);
  });

  it('validates the announcement id', async () => {
    await seedOrgWithAnnouncement();
    expect((await continueAnnouncementDelivery({}, form({ id: 'nope' }))).error?.code).toBe('VALIDATION_ERROR');
  });

  it('sends to active tenants by email and WhatsApp, honouring preferences and opt-in, and records outcomes', async () => {
    const { org, property, ann } = await seedOrgWithAnnouncement();
    const ok = await seedTenant(org.id, property.id, { label: 'ok', whatsappPhone: '+51911111111', whatsappOptIn: true });
    const optedOut = await seedTenant(org.id, property.id, { label: 'optout', announcementsEmail: false, whatsappPhone: '+51922222222' });
    await seedTenant(org.id, property.id, { label: 'ended', contractStatus: 'terminated', whatsappPhone: '+51933333333', whatsappOptIn: true });
    const failing = await seedTenant(org.id, property.id, { label: 'bounce' });
    senders.sendEmail.mockImplementation(async (input) =>
      input.to === 'bounce@example.com' ? { success: false, error: 'bounced' } : { success: true, error: undefined },
    );

    const result = await publishAnnouncement({}, form({ id: ann.id, send_email: 'on', send_whatsapp: 'on' }));
    expect(result.error).toBeUndefined();

    const rows = await deliveriesOf(ann.id);
    const summary = rows.map((r) => `${r.tenantId}:${r.channel}:${r.status}`).sort();
    expect(summary).toEqual([
      `${failing.id}:email:failed`,
      `${ok.id}:email:sent`,
      `${ok.id}:whatsapp:sent`,
    ].sort());
    expect(rows.find((r) => r.status === 'failed')?.error).toBe('bounced');
    expect(rows.some((r) => r.tenantId === optedOut.id)).toBe(false);

    expect(senders.sendEmail.mock.calls.map(([input]) => input.to).sort()).toEqual(['bounce@example.com', 'ok@example.com']);
    const [, template] = senders.sendTemplate.mock.calls[0];
    expect(template).toMatchObject({ to: '+51911111111', templateName: 'comunicado_inquilinos' });
    expect(template.bodyParams).toEqual(['Tenant ok', 'Corte de agua', 'El jueves no habrá agua.']);

    const counts = await loadDeliveryCounts(org.id, [ann.id]);
    expect(counts.get(ann.id)).toEqual({
      email: { pending: 0, sent: 1, failed: 1 },
      whatsapp: { pending: 0, sent: 1, failed: 0 },
    });
    expect((await loadDeliveryCounts(crypto.randomUUID(), [ann.id])).size).toBe(0);
  });

  it('only reaches the targeted property and never re-sends on republish', async () => {
    const { org, property, ann } = await seedOrgWithAnnouncement();
    const other = await seedProperty(db, org.id);
    await db.update(schema.announcements).set({ audience: 'property', propertyId: property.id }).where(eq(schema.announcements.id, ann.id));
    const inside = await seedTenant(org.id, property.id, { label: 'in' });
    await seedTenant(org.id, other.id, { label: 'out' });

    await publishAnnouncement({}, form({ id: ann.id, send_email: 'on' }));
    await publishAnnouncement({}, form({ id: ann.id, send_email: 'on' }));

    const rows = await deliveriesOf(ann.id);
    expect(rows.map((r) => [r.tenantId, r.channel, r.status])).toEqual([[inside.id, 'email', 'sent']]);
    expect(senders.sendEmail).toHaveBeenCalledTimes(1);
  });

  it('publishing without channels delivers nothing', async () => {
    const { org, property, ann } = await seedOrgWithAnnouncement();
    await seedTenant(org.id, property.id, { label: 'quiet' });
    expect((await publishAnnouncement({}, form({ id: ann.id }))).error).toBeUndefined();
    expect(await deliveriesOf(ann.id)).toEqual([]);
  });

  it('sends at most one batch per run and continues with the rest', async () => {
    const { org, property, ann } = await seedOrgWithAnnouncement();
    const total = SENDS_PER_RUN + 3;
    for (let i = 0; i < total; i++) await seedTenant(org.id, property.id, { label: `t${i}` });

    await publishAnnouncement({}, form({ id: ann.id, send_email: 'on' }));
    expect((await loadDeliveryCounts(org.id, [ann.id])).get(ann.id)?.email).toEqual({ pending: 3, sent: SENDS_PER_RUN, failed: 0 });

    expect((await continueAnnouncementDelivery({}, form({ id: ann.id }))).error).toBeUndefined();
    expect((await loadDeliveryCounts(org.id, [ann.id])).get(ann.id)?.email).toEqual({ pending: 0, sent: total, failed: 0 });
    expect(senders.sendEmail).toHaveBeenCalledTimes(total);
  });
});
