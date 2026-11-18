/**
 * Real-SQL smoke test for src/app/actions/leads-pipeline.ts's reorderStages
 * and deleteStage — the multi-statement writes that ran in a Postgres
 * transaction and now run as one D1 batch (W-CF-32). Auth, rate limiting and
 * revalidation are mocked; stage reads and writes hit local D1.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { createSmokeDb, seedOrg, seedLead, type SmokeDb } from './setup';
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
});

afterAll(async () => {
  await smoke.close();
});

describe('leads-pipeline stage actions (real SQL)', () => {
  it('reorderStages writes every position in one batch', async () => {
    const { reorderStages } = await import('@/app/actions/leads-pipeline');
    const { getPipelineStages } = await import('@/lib/leads/stages');
    const org = await seedOrg(smoke.db);
    auth.orgId = org.id;

    const stages = await getPipelineStages(org.id, 'demand', { includeArchived: true });
    const reversed = stages.map((s) => s.id).reverse();

    const result = await reorderStages({ pipeline: 'demand', orderedIds: reversed });
    expect(result.error).toBeUndefined();

    const after = await getPipelineStages(org.id, 'demand', { includeArchived: true });
    expect(after.map((s) => s.id)).toEqual(reversed);
    expect(after.map((s) => s.position)).toEqual(reversed.map((_, i) => i));
  });

  it('deleteStage moves the stage leads and deletes the stage in one batch', async () => {
    const { deleteStage } = await import('@/app/actions/leads-pipeline');
    const { getPipelineStages } = await import('@/lib/leads/stages');
    const org = await seedOrg(smoke.db);
    auth.orgId = org.id;
    await getPipelineStages(org.id, 'demand');

    const [custom] = await smoke.db.insert(schema.leadPipelineStages).values({
      orgId: org.id, pipeline: 'demand', key: 'custom', label: 'Custom', position: 99, kind: 'open',
    }).returning();
    const lead = await seedLead(smoke.db, org.id, { pipeline: 'demand', stage: 'custom' });

    const result = await deleteStage({ id: custom.id, moveLeadsTo: 'contacted' });
    expect(result.error).toBeUndefined();

    const [moved] = await smoke.db.select().from(schema.crmLeads).where(eq(schema.crmLeads.id, lead.id));
    expect(moved.stage).toBe('contacted');
    expect(moved.stageChangedAt).toBeInstanceOf(Date);
    const gone = await smoke.db.select().from(schema.leadPipelineStages)
      .where(and(eq(schema.leadPipelineStages.orgId, org.id), eq(schema.leadPipelineStages.key, 'custom')));
    expect(gone).toHaveLength(0);
  });
});
