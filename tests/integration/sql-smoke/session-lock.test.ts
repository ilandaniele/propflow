/**
 * Real-SQL smoke test for tryAcquireSessionLock and tryLockWebSession: D1 rejects a raw Date bound
 * inside a sql`` fragment, which broke every WhatsApp agent turn in production.
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

describe('agent session lock (real SQL)', () => {
  it('acquires a free lock, refuses a held one, and takes over an expired one', async () => {
    const { tryAcquireSessionLock, releaseSessionLock } = await import('@/lib/agent/session');
    const org = await seedOrg(smoke.db);
    const [session] = await smoke.db
      .insert(schema.agentSessions)
      .values({ orgId: org.id, channel: 'whatsapp', externalId: '+51900000001' })
      .returning({ id: schema.agentSessions.id });

    expect(await tryAcquireSessionLock(session.id)).toBe(true);
    expect(await tryAcquireSessionLock(session.id)).toBe(false);

    await releaseSessionLock(session.id);
    expect(await tryAcquireSessionLock(session.id, -1000)).toBe(true);
    expect(await tryAcquireSessionLock(session.id)).toBe(true);
  });

  it('web session lock: acquires a free lock and refuses a held one', async () => {
    const { tryLockWebSession } = await import('@/lib/widget/web-session');
    const org = await seedOrg(smoke.db);
    const [web] = await smoke.db
      .insert(schema.agentWebSessions)
      .values({ orgId: org.id, tokenHash: `hash-${org.id}`, expiresAt: new Date(Date.now() + 3_600_000) })
      .returning({ id: schema.agentWebSessions.id });

    expect(await tryLockWebSession(web.id)).toBe(true);
    expect(await tryLockWebSession(web.id)).toBe(false);
  });
});
