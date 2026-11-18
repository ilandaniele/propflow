/**
 * Real-SQL smoke test for src/app/actions/agent-setup.ts's
 * saveWhatsAppChannel — the conflict check + upsert that ran in a Postgres
 * transaction and now reads first, then writes once (W-CF-32). Auth, rate
 * limiting and revalidation are mocked; WHATSAPP_* env vars are cleared, so
 * no Graph call is made.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { createSmokeDb, seedOrg, type SmokeDb } from './setup';
import * as schema from '@/lib/db/schema';

const dbBox = vi.hoisted(() => ({ current: undefined as unknown }));
const auth = vi.hoisted(() => ({ orgId: '' }));
vi.mock('@/lib/db', () => ({
  get db() {
    return dbBox.current;
  },
}));
vi.mock('@/lib/auth/guards', () => ({
  requireAdmin: vi.fn(async () => ({ userId: 'user-1', orgId: auth.orgId, role: 'admin', profile: {} })),
}));
vi.mock('@/lib/ratelimit', () => ({ mutationRateLimit: vi.fn(() => ({ success: true })) }));
vi.mock('@/lib/log', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), adminAction: vi.fn() } }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

let smoke: { db: SmokeDb; close: () => Promise<void> };

beforeAll(async () => {
  smoke = await createSmokeDb();
  dbBox.current = smoke.db;
  vi.stubEnv('WHATSAPP_PHONE_NUMBER_ID', '');
  vi.stubEnv('WHATSAPP_ACCESS_TOKEN', '');
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await smoke.close();
});

function whatsappRows(orgId: string) {
  return smoke.db.select().from(schema.orgChannels)
    .where(and(eq(schema.orgChannels.orgId, orgId), eq(schema.orgChannels.channel, 'whatsapp')));
}

describe('saveWhatsAppChannel (real SQL)', () => {
  it('inserts, updates the same row, and rejects a number bound to another org', async () => {
    const { saveWhatsAppChannel } = await import('@/app/actions/agent-setup');
    const org = await seedOrg(smoke.db);
    const other = await seedOrg(smoke.db, { name: 'Other Org' });

    auth.orgId = org.id;
    expect((await saveWhatsAppChannel({ phoneNumberId: '111111111', displayPhoneE164: '+51911111111' })).error).toBeUndefined();
    expect((await saveWhatsAppChannel({ phoneNumberId: '222222222', displayPhoneE164: '+51922222222' })).error).toBeUndefined();

    const rows = await whatsappRows(org.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ externalId: '222222222', config: { displayPhoneE164: '+51922222222' } });

    auth.orgId = other.id;
    const conflict = await saveWhatsAppChannel({ phoneNumberId: '222222222', displayPhoneE164: '+51933333333' });
    expect(conflict.error?.code).toBe('CONFLICT');
    expect(await whatsappRows(other.id)).toHaveLength(0);
  });
});
