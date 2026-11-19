/**
 * Real-SQL smoke test for src/lib/agent/suggestions.ts's createSuggestion —
 * supersede + insert, formerly a Postgres transaction, now one D1 batch
 * (W-CF-32). The partial unique index agent_suggestions_one_pending makes
 * the statement order load-bearing.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { createSmokeDb, seedOrg, seedSession, type SmokeDb } from './setup';
import * as schema from '@/lib/db/schema';

const dbBox = vi.hoisted(() => ({ current: undefined as unknown }));
vi.mock('@/lib/db', () => ({
  get db() {
    return dbBox.current;
  },
}));

let smoke: { db: SmokeDb; close: () => Promise<void> };

beforeAll(async () => {
  smoke = await createSmokeDb();
  dbBox.current = smoke.db;
});

afterAll(async () => {
  await smoke.close();
});

describe('createSuggestion (real SQL)', () => {
  it('supersedes the pending suggestion and inserts the new one atomically', async () => {
    const { createSuggestion } = await import('@/lib/agent/suggestions');
    const org = await seedOrg(smoke.db);
    const session = await seedSession(smoke.db, org.id);

    const first = await createSuggestion({ orgId: org.id, sessionId: session.id, conversationId: null, body: 'uno' });
    const second = await createSuggestion({ orgId: org.id, sessionId: session.id, conversationId: null, body: 'dos' });
    expect(second).not.toBe(first);

    const rows = await smoke.db.select().from(schema.agentSuggestions)
      .where(eq(schema.agentSuggestions.sessionId, session.id));
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get(first)).toMatchObject({ status: 'superseded', body: 'uno' });
    expect(byId.get(first)?.decidedAt).toBeInstanceOf(Date);
    expect(byId.get(second)).toMatchObject({ status: 'pending', body: 'dos' });
  });
});
