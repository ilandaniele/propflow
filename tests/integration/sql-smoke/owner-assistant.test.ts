/**
 * Real-SQL smoke test for the WhatsApp owner assistant (src/lib/owner-assistant):
 * phone linking, expense/payment recording, and the webhook handler with a fake provider.
 */

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import * as schema from '@/lib/db/schema';
import type { IWhatsAppProvider } from '@/lib/whatsapp/provider';
import type { NormalizedInboundMessage } from '@/lib/whatsapp/meta-webhook-parser';
import { createSmokeDb, seedOrg, seedProfile, seedProperty, type SmokeDb } from './setup';

const dbBox = vi.hoisted(() => ({ current: undefined as unknown }));
vi.mock('@/lib/db', () => ({
  get db() {
    return dbBox.current;
  },
}));

const mocks = vi.hoisted(() => ({
  runOcr: vi.fn(),
  transcribeAudio: vi.fn(),
  transcriptionEnabled: vi.fn(() => true),
}));
vi.mock('@/lib/storage', () => ({ getSignedUrl: vi.fn(async () => 'https://r2.example/signed') }));
vi.mock('@/lib/ocr/run-ocr', () => ({ runOcr: mocks.runOcr }));
vi.mock('@/lib/owner-assistant/transcribe', () => ({
  transcribeAudio: mocks.transcribeAudio,
  transcriptionEnabled: mocks.transcriptionEnabled,
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
  vi.unstubAllGlobals();
  mocks.runOcr.mockReset();
  mocks.transcribeAudio.mockReset();
  mocks.transcriptionEnabled.mockReturnValue(true);
});

let seq = 0;
const PHONE = '+51987654321';

function fakeProvider() {
  const sent: string[] = [];
  const provider = {
    sendMessage: vi.fn(async (_orgId: string, msg: { body?: string }) => {
      sent.push(msg.body ?? '');
      return { success: true as const, providerMessageId: 'out' };
    }),
    downloadAttachment: vi.fn(async (_o: string, _m: string, _b: string, storagePath: string) => ({ storagePath })),
    validateWebhookSignature: () => true,
  } as unknown as IWhatsAppProvider;
  return { provider, sent };
}

function inbound(overrides: Partial<NormalizedInboundMessage>): NormalizedInboundMessage {
  seq += 1;
  return {
    providerMessageId: `wamid.test.${seq}.${Date.now()}`,
    from: PHONE.slice(1),
    type: 'text',
    text: null,
    mediaId: null,
    mimeType: null,
    timestamp: new Date(),
    interactiveReplyId: null,
    referral: null,
    ...overrides,
  } as NormalizedInboundMessage;
}

async function seedAdmin(email: string) {
  const org = await seedOrg(smoke.db);
  const admin = await seedProfile(smoke.db, org.id, { email });
  return { orgId: org.id, profileId: admin.id };
}

async function linkedAdmin(email: string) {
  const { requestLinkCode, verifyLinkCode } = await import('@/lib/owner-assistant/links');
  const ctx = await seedAdmin(email);
  const issued = await requestLinkCode(ctx.orgId, ctx.profileId, PHONE);
  expect(await verifyLinkCode(ctx.orgId, PHONE, issued!.code)).toBe('verified');
  return ctx;
}

async function seedActiveTenant(orgId: string, fullName: string) {
  const property = await seedProperty(smoke.db, orgId);
  const [unit] = await smoke.db.insert(schema.units).values({ orgId, propertyId: property.id, label: fullName.slice(0, 4) }).returning();
  const [tenant] = await smoke.db.insert(schema.tenants).values({ orgId, fullName, unitId: unit.id }).returning();
  await smoke.db.insert(schema.contracts).values({ orgId, tenantId: tenant.id, unitId: unit.id, startDate: '2026-01-01', monthlyRent: '800.00' });
  return tenant.id;
}

describe('owner assistant links (real SQL)', () => {
  it('verifies a fresh code once and then finds the verified link', async () => {
    const { requestLinkCode, verifyLinkCode, findVerifiedLink } = await import('@/lib/owner-assistant/links');
    const ctx = await seedAdmin('oa-verify@example.com');
    const issued = await requestLinkCode(ctx.orgId, ctx.profileId, PHONE);

    expect(await findVerifiedLink(ctx.orgId, PHONE)).toBeNull();
    expect(await verifyLinkCode(ctx.orgId, PHONE, issued!.code === '000000' ? '111111' : '000000')).toBe('invalid');
    expect(await verifyLinkCode(ctx.orgId, PHONE, issued!.code)).toBe('verified');
    expect(await verifyLinkCode(ctx.orgId, PHONE, issued!.code)).toBe('none');
    expect(await findVerifiedLink(ctx.orgId, PHONE)).toMatchObject({ profileId: ctx.profileId });
  });

  it('rejects expired codes and locks after too many attempts', async () => {
    const { requestLinkCode, verifyLinkCode, MAX_LINK_ATTEMPTS } = await import('@/lib/owner-assistant/links');
    const expired = await seedAdmin('oa-expired@example.com');
    const code = (await requestLinkCode(expired.orgId, expired.profileId, PHONE))!.code;
    expect(await verifyLinkCode(expired.orgId, PHONE, code, new Date(Date.now() + 16 * 60_000))).toBe('expired');

    const locked = await seedAdmin('oa-locked@example.com');
    const real = (await requestLinkCode(locked.orgId, locked.profileId, PHONE))!.code;
    const wrong = real === '000000' ? '111111' : '000000';
    for (let i = 0; i < MAX_LINK_ATTEMPTS; i += 1) expect(await verifyLinkCode(locked.orgId, PHONE, wrong)).toBe('invalid');
    expect(await verifyLinkCode(locked.orgId, PHONE, real)).toBe('locked');
  });

  it('scopes links by org and refuses a phone already used by another admin of the org', async () => {
    const { requestLinkCode, findVerifiedLink } = await import('@/lib/owner-assistant/links');
    const a = await linkedAdmin('oa-scope-a@example.com');
    const other = await seedOrg(smoke.db);

    expect(await findVerifiedLink(other.id, PHONE)).toBeNull();
    const second = await seedProfile(smoke.db, a.orgId, { email: 'oa-scope-b@example.com' });
    expect(await requestLinkCode(a.orgId, second.id, PHONE)).toBeNull();
  });

  it('ignores the link once the profile is no longer an admin', async () => {
    const { findVerifiedLink } = await import('@/lib/owner-assistant/links');
    const ctx = await linkedAdmin('oa-demoted@example.com');
    await smoke.db.update(schema.profiles).set({ role: 'tenant' }).where(eq(schema.profiles.id, ctx.profileId));
    expect(await findVerifiedLink(ctx.orgId, PHONE)).toBeNull();
  });
});

describe('handleOwnerAssistantMessage (real SQL)', () => {
  it('returns false for unknown senders so the tenant/lead flow runs', async () => {
    const { handleOwnerAssistantMessage } = await import('@/lib/owner-assistant/handle');
    const ctx = await seedAdmin('oa-stranger@example.com');
    const { provider } = fakeProvider();

    expect(await handleOwnerAssistantMessage(ctx.orgId, inbound({ text: 'gasto 10 luz' }), provider)).toBe(false);
    expect(await handleOwnerAssistantMessage(ctx.orgId, inbound({ text: 'VINCULAR 123456' }), provider)).toBe(false);
    expect(provider.sendMessage).not.toHaveBeenCalled();
  });

  it('links the phone through a VINCULAR message', async () => {
    const { requestLinkCode, findVerifiedLink } = await import('@/lib/owner-assistant/links');
    const { handleOwnerAssistantMessage } = await import('@/lib/owner-assistant/handle');
    const ctx = await seedAdmin('oa-wa-link@example.com');
    const { code } = (await requestLinkCode(ctx.orgId, ctx.profileId, PHONE))!;
    const { provider, sent } = fakeProvider();

    expect(await handleOwnerAssistantMessage(ctx.orgId, inbound({ text: `vincular ${code}` }), provider)).toBe(true);
    expect(sent[0]).toMatch(/vinculado/i);
    expect(await findVerifiedLink(ctx.orgId, PHONE)).not.toBeNull();
  });

  it('records a text expense once, even when Meta retries the message', async () => {
    const { handleOwnerAssistantMessage } = await import('@/lib/owner-assistant/handle');
    const ctx = await linkedAdmin('oa-expense@example.com');
    const { provider, sent } = fakeProvider();
    const message = inbound({ text: 'gasto 120,50 pintura' });

    expect(await handleOwnerAssistantMessage(ctx.orgId, message, provider)).toBe(true);
    expect(await handleOwnerAssistantMessage(ctx.orgId, message, provider)).toBe(true);

    const rows = await smoke.db.select().from(schema.expenses).where(eq(schema.expenses.orgId, ctx.orgId));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ amount: '120.50', description: 'pintura' });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain('120.50');
    const [log] = await smoke.db.select().from(schema.ownerAssistantMessages).where(eq(schema.ownerAssistantMessages.orgId, ctx.orgId));
    expect(log).toMatchObject({ outcome: 'expense', recordId: rows[0].id });
  });

  it('records an approved payment for a single matching tenant and refuses ambiguous names', async () => {
    const { handleOwnerAssistantMessage } = await import('@/lib/owner-assistant/handle');
    const ctx = await linkedAdmin('oa-payment@example.com');
    const tenantId = await seedActiveTenant(ctx.orgId, 'Lucía Romero');
    await seedActiveTenant(ctx.orgId, 'Mario Rossi');
    await seedActiveTenant(ctx.orgId, 'Mario Ruiz');
    const { provider, sent } = fakeProvider();

    await handleOwnerAssistantMessage(ctx.orgId, inbound({ text: 'pago 800 lucía' }), provider);
    await handleOwnerAssistantMessage(ctx.orgId, inbound({ text: 'pago 800 mario' }), provider);
    await handleOwnerAssistantMessage(ctx.orgId, inbound({ text: 'pago 800 nadie' }), provider);

    const rows = await smoke.db.select().from(schema.payments).where(eq(schema.payments.orgId, ctx.orgId));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ tenantId, amount: '800.00', status: 'approved', approvedBy: ctx.profileId });
    expect(sent[1]).toMatch(/Mario R/);
    expect(sent[2]).toContain('nadie');
  });

  it('does not match tenants of another org', async () => {
    const { handleOwnerAssistantMessage } = await import('@/lib/owner-assistant/handle');
    const ctx = await linkedAdmin('oa-payment-iso@example.com');
    const other = await seedOrg(smoke.db);
    await seedActiveTenant(other.id, 'Zoe Foreign');
    const { provider } = fakeProvider();

    await handleOwnerAssistantMessage(ctx.orgId, inbound({ text: 'pago 500 zoe' }), provider);
    expect(await smoke.db.select().from(schema.payments).where(eq(schema.payments.tenantId, other.id))).toHaveLength(0);
  });

  it('records a receipt photo through OCR with the stored receipt path', async () => {
    const { handleOwnerAssistantMessage } = await import('@/lib/owner-assistant/handle');
    const ctx = await linkedAdmin('oa-photo@example.com');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/jpeg' } })));
    mocks.runOcr.mockResolvedValue({ success: true, data: { amount: 75, date: '2026-11-20', vendor: 'Ferretería', confidence: 0.9 } });
    const { provider, sent } = fakeProvider();

    await handleOwnerAssistantMessage(ctx.orgId, inbound({ type: 'image', mediaId: 'media-1', mimeType: 'image/jpeg' }), provider);

    const [row] = await smoke.db.select().from(schema.expenses).where(eq(schema.expenses.orgId, ctx.orgId));
    expect(row).toMatchObject({ amount: '75.00', description: 'Ferretería', incurredOn: '2026-11-20' });
    expect(row.receiptPath).toContain(`owner-assistant/${ctx.orgId}/`);
    expect(sent[0]).toContain('75.00');
  });

  it('runs a transcribed voice note as a command, and says so when voice is off', async () => {
    const { handleOwnerAssistantMessage } = await import('@/lib/owner-assistant/handle');
    const ctx = await linkedAdmin('oa-voice@example.com');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([1]), { headers: { 'content-type': 'audio/ogg' } })));
    mocks.transcribeAudio.mockResolvedValue('gasto 30 gasfitero');
    const { provider, sent } = fakeProvider();

    await handleOwnerAssistantMessage(ctx.orgId, inbound({ type: 'audio', mediaId: 'media-2' }), provider);
    mocks.transcriptionEnabled.mockReturnValue(false);
    await handleOwnerAssistantMessage(ctx.orgId, inbound({ type: 'audio', mediaId: 'media-3' }), provider);

    const rows = await smoke.db.select().from(schema.expenses).where(eq(schema.expenses.orgId, ctx.orgId));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ amount: '30.00', description: 'gasfitero' });
    expect(sent[0]).toContain('gasto 30 gasfitero');
    expect(sent[1]).toMatch(/audios/i);
  });

  it('answers help for unknown text without recording anything', async () => {
    const { handleOwnerAssistantMessage } = await import('@/lib/owner-assistant/handle');
    const ctx = await linkedAdmin('oa-help@example.com');
    const { provider, sent } = fakeProvider();

    await handleOwnerAssistantMessage(ctx.orgId, inbound({ text: 'hola' }), provider);
    await handleOwnerAssistantMessage(ctx.orgId, inbound({ text: 'ayuda' }), provider);

    expect(await smoke.db.select().from(schema.expenses).where(eq(schema.expenses.orgId, ctx.orgId))).toHaveLength(0);
    expect(sent[0]).toMatch(/AYUDA/);
    expect(sent[1]).toMatch(/GASTO/);
  });
});
