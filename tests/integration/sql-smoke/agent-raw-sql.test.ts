/**
 * Real-SQL smoke test for the agent's hand-written SQLite fragments (W-CF-35):
 * LIKE ... ESCAPE in voice/dnc.ts and listings.ts, the CAST price filter in
 * listings.ts, and json_set on crm_leads.source_meta in web-handoff-redeem.ts
 * and tools/continue-on-whatsapp.ts. Everything outside the SQL under test
 * (handoff codes, sessions, events, widget channel) is mocked.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import * as schema from '@/lib/db/schema';
import { createSmokeDb, seedOrg, seedLead, seedListing, seedProperty, type SmokeDb } from './setup';

const dbBox = vi.hoisted(() => ({ current: undefined as unknown }));
vi.mock('@/lib/db', () => ({
  get db() {
    return dbBox.current;
  },
}));

const claimHandoffCode = vi.hoisted(() => vi.fn());
vi.mock('@/lib/widget/handoff-codes', () => ({
  claimHandoffCode,
  createHandoffCode: vi.fn(async () => ({ id: 'code-1', code: 'WEB-ABCDEF', kind: 'continue' })),
  extractHandoffCode: (text: string) => text.match(/WEB-[A-Z0-9]{6}/)?.[0] ?? null,
  finishHandoffCode: vi.fn(async () => {}),
  getLatestPendingVoiceCodeForPhone: vi.fn(async () => null),
}));
vi.mock('@/lib/agent/session', () => ({ setSessionLead: vi.fn(async () => {}) }));
vi.mock('@/lib/agent/events', () => ({ recordAgentEvent: vi.fn(async () => {}) }));
vi.mock('@/lib/widget/web-session', () => ({ setWebSessionPhone: vi.fn(async () => {}) }));
vi.mock('@/lib/widget/channel', () => ({ getWhatsAppDisplayPhone: vi.fn(async () => '+51999999999') }));

let smoke: { db: SmokeDb; close: () => Promise<void> };

beforeAll(async () => {
  smoke = await createSmokeDb();
  dbBox.current = smoke.db;
});

afterAll(async () => {
  await smoke.close();
});

async function sourceMetaOf(db: SmokeDb, leadId: string): Promise<Record<string, unknown>> {
  const [row] = await db.select({ sourceMeta: schema.crmLeads.sourceMeta }).from(schema.crmLeads).where(eq(schema.crmLeads.id, leadId));
  return row.sourceMeta;
}

describe('agent raw SQL (real SQL)', () => {
  it('listDoNotCall matches case-insensitively and treats % and _ literally', async () => {
    const { db } = await import('@/lib/db');
    const { addDoNotCall, listDoNotCall } = await import('@/lib/agent/voice/dnc');
    const typedDb = db as unknown as SmokeDb;

    const org = await seedOrg(typedDb);
    await addDoNotCall({ orgId: org.id, phoneE164: '+51987654321', source: 'staff', reason: 'Pidió NO llamar' });
    await addDoNotCall({ orgId: org.id, phoneE164: '+51987654322', source: 'staff', reason: '100% spam' });
    await addDoNotCall({ orgId: org.id, phoneE164: '+51987654323', source: 'staff', reason: '1000 spam' });

    const byReason = await listDoNotCall(org.id, { q: 'no llamar' });
    expect(byReason.total).toBe(1);
    expect(byReason.items[0].phoneE164).toBe('+51987654321');

    const literalPercent = await listDoNotCall(org.id, { q: '100%' });
    expect(literalPercent.items.map((i) => i.phoneE164)).toEqual(['+51987654322']);

    const literalUnderscore = await listDoNotCall(org.id, { q: '_' });
    expect(literalUnderscore.total).toBe(0);
  });

  it('searchListings filters zone with LIKE and budget numerically over TEXT prices', async () => {
    const { db } = await import('@/lib/db');
    const { searchListings } = await import('@/lib/agent/listings');
    const typedDb = db as unknown as SmokeDb;

    const org = await seedOrg(typedDb);
    const property = await seedProperty(typedDb, org.id);
    const base = { operation: 'rent', propertyId: property.id, published: true, status: 'available' };
    const cheap = await seedListing(typedDb, org.id, { ...base, zone: 'Miraflores', price: '900.00' });
    await seedListing(typedDb, org.id, { ...base, zone: 'Miraflores', price: '1500.00' });
    await seedListing(typedDb, org.id, { ...base, zone: 'Surco', price: '800.00' });

    const rows = await searchListings(org.id, { zone: 'mira', budgetMax: 1000 });

    expect(rows.map((r) => r.id)).toEqual([cheap.id]);
  });

  it('redeemWebHandoffCode sets source_meta.phoneVerified=true and keeps other keys', async () => {
    const { db } = await import('@/lib/db');
    const { redeemWebHandoffCode } = await import('@/lib/agent/web-handoff-redeem');
    const typedDb = db as unknown as SmokeDb;

    const org = await seedOrg(typedDb);
    const lead = await seedLead(typedDb, org.id, { sourceMeta: { utm: 'ig', phoneVerified: false } });
    claimHandoffCode.mockResolvedValueOnce({ id: 'code-1', kind: 'continue', leadId: lead.id });

    const outcome = await redeemWebHandoffCode({
      orgId: org.id,
      phoneE164: '+51987654321',
      text: 'Hola WEB-ABCDEF',
      whatsappSession: { id: 'session-1', leadId: null },
    });

    expect(outcome.kind).toBe('linked');
    expect(await sourceMetaOf(typedDb, lead.id)).toEqual({ utm: 'ig', phoneVerified: true });
  });

  it('continue_on_whatsapp stores the typed phone with source_meta.phoneVerified=false', async () => {
    const { db } = await import('@/lib/db');
    const { makeContinueOnWhatsappTool } = await import('@/lib/agent/tools/continue-on-whatsapp');
    const typedDb = db as unknown as SmokeDb;

    const org = await seedOrg(typedDb);
    const lead = await seedLead(typedDb, org.id, { sourceMeta: { utm: 'web' } });
    const tool = makeContinueOnWhatsappTool({
      orgId: org.id,
      sessionId: 'session-1',
      channel: 'web',
      externalId: 'web:session',
      dryRun: false,
      leadIdRef: { current: lead.id },
      attribution: null,
      webSessionId: 'web-session-1',
    });

    await tool.run({ phone: '987654321' });

    const [row] = await typedDb.select({ phone: schema.crmLeads.phone }).from(schema.crmLeads).where(eq(schema.crmLeads.id, lead.id));
    expect(row.phone).not.toBeNull();
    expect(await sourceMetaOf(typedDb, lead.id)).toEqual({ utm: 'web', phoneVerified: false });
  });
});
