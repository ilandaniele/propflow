import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import * as schema from '@/lib/db/schema';
import { createSmokeDb, seedOrg, seedProfile, type SmokeDb } from './setup';

const auth = vi.hoisted(() => ({ ctx: { userId: '', orgId: '', role: 'admin' } }));
vi.mock('@/lib/auth/guards', () => ({ requireAdmin: vi.fn(async () => auth.ctx) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/ratelimit', () => ({ mutationRateLimit: vi.fn(() => ({ success: true })) }));

let smoke: { db: SmokeDb; close: () => Promise<void> };
let db: SmokeDb;

beforeAll(async () => {
  smoke = await createSmokeDb();
  db = smoke.db;
});

afterAll(async () => {
  await smoke.close();
});

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.append(key, value);
  return data;
}

async function actAs(orgId: string) {
  const profile = await seedProfile(db, orgId);
  auth.ctx = { userId: profile.id, orgId, role: 'admin' };
}

describe('saveChargeConcept (real SQL)', () => {
  it('creates and then edits a concept inside the admin org', async () => {
    const { saveChargeConcept } = await import('@/app/actions/charge-concepts');
    const org = await seedOrg(db);
    await actAs(org.id);

    expect(await saveChargeConcept({}, form({ description: 'Agua', code: 'AG', base_amount: '35' }))).toEqual({ data: undefined });
    const [created] = await db.select().from(schema.chargeConcepts).where(eq(schema.chargeConcepts.orgId, org.id));
    expect(created).toMatchObject({ description: 'Agua', code: 'AG', baseAmount: '35' });

    expect(await saveChargeConcept({}, form({ id: created.id, description: 'Agua potable', code: '', base_amount: '' }))).toEqual({ data: undefined });
    const [edited] = await db.select().from(schema.chargeConcepts).where(eq(schema.chargeConcepts.id, created.id));
    expect(edited).toMatchObject({ description: 'Agua potable', code: null, baseAmount: null });
  });

  it('refuses to edit a concept from another org', async () => {
    const { saveChargeConcept } = await import('@/app/actions/charge-concepts');
    const owner = await seedOrg(db);
    const [foreign] = await db.insert(schema.chargeConcepts).values({ orgId: owner.id, description: 'Luz' }).returning();
    const attacker = await seedOrg(db);
    await actAs(attacker.id);

    const result = await saveChargeConcept({}, form({ id: foreign.id, description: 'Hacked' }));
    expect(result.error?.code).toBe('NOT_FOUND');
    const [unchanged] = await db.select().from(schema.chargeConcepts).where(eq(schema.chargeConcepts.id, foreign.id));
    expect(unchanged.description).toBe('Luz');
  });

  it('rejects invalid input without writing', async () => {
    const { saveChargeConcept } = await import('@/app/actions/charge-concepts');
    const org = await seedOrg(db);
    await actAs(org.id);

    expect((await saveChargeConcept({}, form({ description: '' }))).error?.code).toBe('VALIDATION_ERROR');
    expect(await db.select().from(schema.chargeConcepts).where(eq(schema.chargeConcepts.orgId, org.id))).toEqual([]);
  });
});
