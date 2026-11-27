/**
 * Real-SQL smoke test for claimPendingInbound: a turn killed mid-flight (Worker
 * waitUntil limit) leaves its messages 'processing'; the next turn, holding the
 * session lock, must pick them up again.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import * as schema from '@/lib/db/schema';
import { createSmokeDb, seedOrg, type SmokeDb } from './setup';

const dbBox = vi.hoisted(() => ({ current: undefined as unknown }));
vi.mock('@/lib/db', () => ({
  get db() {
    return dbBox.current;
  },
}));
vi.mock('@/lib/log', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

let smoke: { db: SmokeDb; close: () => Promise<void> };

beforeAll(async () => {
  smoke = await createSmokeDb();
  dbBox.current = smoke.db;
});

afterAll(async () => {
  await smoke.close();
});

describe('claimPendingInbound (real SQL)', () => {
  it('reclaims messages a killed turn left processing, but not finished ones', async () => {
    const { claimPendingInbound } = await import('@/lib/whatsapp/db');
    const org = await seedOrg(smoke.db);
    const [conv] = await smoke.db
      .insert(schema.whatsappConversations)
      .values({ orgId: org.id, externalPhone: '+51900000002' })
      .returning({ id: schema.whatsappConversations.id });
    const message = (body: string, agentStatus: string) => ({
      orgId: org.id,
      conversationId: conv.id,
      direction: 'inbound',
      body,
      agentStatus,
      agentClaimedAt: agentStatus === 'processing' ? new Date(Date.now() - 30_000) : null,
    });
    await smoke.db.insert(schema.whatsappMessages).values([
      message('orphan', 'processing'),
      message('new', 'pending'),
      message('done', 'processed'),
    ]);

    const claimed = await claimPendingInbound(org.id, conv.id);
    expect(claimed.map((m) => m.body).sort()).toEqual(['new', 'orphan']);
  });
});
