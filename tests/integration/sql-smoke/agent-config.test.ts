/**
 * Real-SQL smoke test for the agent_configs / org_channels updates in
 * src/lib/agent/config.ts and src/lib/widget/channel.ts. They used to stamp
 * updated_at with Postgres now(), which SQLite does not have.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { createSmokeDb, seedOrg, type SmokeDb } from './setup';
import * as schema from '@/lib/db/schema';

const dbBox = vi.hoisted(() => ({ current: undefined as unknown }));
vi.mock('@/lib/db', () => ({
  get db() {
    return dbBox.current;
  },
}));
vi.mock('@/lib/log', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

let smoke: { db: SmokeDb; close: () => Promise<void> };

beforeAll(async () => {
  smoke = await createSmokeDb();
  dbBox.current = smoke.db;
});

afterAll(async () => {
  await smoke.close();
});

const configOf = async (orgId: string) =>
  (await smoke.db.select().from(schema.agentConfigs).where(eq(schema.agentConfigs.orgId, orgId)))[0];

describe('agent config updates (real SQL)', () => {
  it('stamps updated_at as a Date on every update path', async () => {
    const { setPublicPagesEnabled, updateAgentLiveSettings, updateAgentConfig } = await import('@/lib/agent/config');
    const { upsertWebChannel } = await import('@/lib/widget/channel');
    const org = await seedOrg(smoke.db);
    const before = Date.now();

    await setPublicPagesEnabled(org.id, true);
    expect((await configOf(org.id)).publicPagesEnabled).toBe(true);

    expect((await updateAgentLiveSettings(org.id, { shadowMode: true })).shadowMode).toBe(true);
    expect((await updateAgentConfig(org.id, { maxAgentTurns: 7 })).maxAgentTurns).toBe(7);
    await upsertWebChannel(org.id, { enabled: true, allowedOrigins: ['https://example.com'] });

    const row = await configOf(org.id);
    expect(row.widgetAllowedOrigins).toEqual(['https://example.com']);
    expect(row.updatedAt).toBeInstanceOf(Date);
    expect(row.updatedAt.getTime()).toBeGreaterThanOrEqual(before - 1000);
  });
});
