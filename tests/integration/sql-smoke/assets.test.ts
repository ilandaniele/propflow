import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createSmokeDb, seedOrg, seedProfile, seedProperty, type SmokeDb } from './setup';

const auth = vi.hoisted(() => ({ ctx: { userId: '', orgId: '', role: 'admin' } }));
vi.mock('@/lib/auth/guards', () => ({
  requireAdmin: vi.fn(async () => {
    if (auth.ctx.role !== 'admin') throw new Error('FORBIDDEN');
    return auth.ctx;
  }),
}));
vi.mock('@/lib/ratelimit', () => ({ mutationRateLimit: vi.fn(() => ({ success: true })) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { completeAssetTask, createAsset, createAssetTask } from '@/app/actions/assets';
import { assetLogs, listAssetTasks, logsForYear } from '@/lib/assets/assets';

let smoke: { db: SmokeDb; close: () => Promise<void> };
let db: SmokeDb;

beforeAll(async () => {
  smoke = await createSmokeDb();
  db = smoke.db;
});

afterAll(async () => {
  await smoke.close();
});

function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

async function seedAdmin() {
  const org = await seedOrg(db);
  const admin = await seedProfile(db, org.id, { email: `admin-${org.id}@example.com` });
  const property = await seedProperty(db, org.id);
  auth.ctx = { userId: admin.id, orgId: org.id, role: 'admin' };
  return { org, admin, property };
}

const newAsset = (propertyId: string, name = 'Ascensor A') =>
  createAsset(null, form({ property_id: propertyId, name, category: 'elevator', location: 'Hall' }));

const newTask = (assetId: string, extra: Record<string, string> = {}) =>
  createAssetTask(null, form({ asset_id: assetId, title: 'Revisión mensual', frequency_months: '1', starts_on: '2026-01-01', estimated_cost: '250', ...extra }));

describe('assets and preventive maintenance (real SQL)', () => {
  it('creates assets, rejects duplicates, foreign properties and bad input', async () => {
    const { property } = await seedAdmin();
    expect((await newAsset(property.id)).data?.assetId).toBeTruthy();
    expect((await newAsset(property.id)).error?.code).toBe('CONFLICT');

    const foreign = await seedProperty(db, (await seedOrg(db)).id);
    expect((await newAsset(foreign.id, 'Bomba')).error?.code).toBe('NOT_FOUND');

    const bad = await createAsset(null, form({ property_id: property.id, name: 'X', category: 'spaceship' }));
    expect(bad.error?.code).toBe('VALIDATION_ERROR');
  });

  it('plans tasks, logs completions and reports last done date', async () => {
    const { org, property } = await seedAdmin();
    const assetId = (await newAsset(property.id)).data!.assetId;
    const taskId = (await newTask(assetId)).data!.taskId;

    expect((await newTask(assetId, { frequency_months: '0' })).error?.code).toBe('VALIDATION_ERROR');

    await completeAssetTask(null, form({ task_id: taskId, done_on: '2026-02-03', cost: '240.5' }));
    const latest = await completeAssetTask(null, form({ task_id: taskId, done_on: '2026-03-04', notes: 'OK' }));
    expect(latest.data?.logId).toBeTruthy();

    const [task] = await listAssetTasks(org.id, assetId);
    expect(task).toMatchObject({ title: 'Revisión mensual', estimatedCost: '250.00', lastDoneOn: '2026-03-04' });

    const logs = await assetLogs(org.id, assetId);
    expect(logs.map((row) => row.doneOn)).toEqual(['2026-03-04', '2026-02-03']);
    expect(logs[1].cost).toBe('240.50');

    expect((await logsForYear(org.id, 2026)).length).toBe(2);
    expect((await logsForYear(org.id, 2025)).length).toBe(0);
  });

  it('rejects future completions, cross-org access and non-admins', async () => {
    const { property } = await seedAdmin();
    const assetId = (await newAsset(property.id)).data!.assetId;
    const taskId = (await newTask(assetId)).data!.taskId;

    const future = await completeAssetTask(null, form({ task_id: taskId, done_on: '2099-01-01' }));
    expect(future.error?.code).toBe('FUTURE_DATE');

    await seedAdmin();
    expect((await newTask(assetId)).error?.code).toBe('NOT_FOUND');
    expect((await completeAssetTask(null, form({ task_id: taskId, done_on: '2026-01-01' }))).error?.code).toBe('NOT_FOUND');

    auth.ctx = { ...auth.ctx, role: 'tenant' };
    expect((await newAsset(property.id, 'Otro')).error?.code).toBe('UNAUTHORIZED');
  });
});
