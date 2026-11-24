import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import * as schema from '@/lib/db/schema';
import { createSmokeDb, seedOrg, seedProperty, type SmokeDb } from './setup';

const dbBox = vi.hoisted(() => ({ current: undefined as unknown }));
vi.mock('@/lib/db', () => ({
  get db() {
    return dbBox.current;
  },
}));

const authBox = vi.hoisted(() => ({ ctx: null as null | { userId: string; orgId: string } }));
vi.mock('@/lib/auth/guards', () => ({
  requireAdmin: async () => {
    if (!authBox.ctx) throw new Error('unauthorized');
    return authBox.ctx;
  },
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const { listPropertyGroups } = await import('@/lib/property-groups/queries');
const actions = await import('@/app/actions/property-groups');

let smoke: { db: SmokeDb; close: () => Promise<void> };

beforeAll(async () => {
  smoke = await createSmokeDb();
  dbBox.current = smoke.db;
});

afterAll(async () => {
  await smoke.close();
});

beforeEach(() => {
  authBox.ctx = null;
});

function form(name: string, propertyIds: string[]): FormData {
  const fd = new FormData();
  fd.set('name', name);
  for (const id of propertyIds) fd.append('property_ids', id);
  return fd;
}

describe('createPropertyGroup', () => {
  it('rejects anonymous callers', async () => {
    expect((await actions.createPropertyGroup({}, form('X', [crypto.randomUUID()]))).error?.code).toBe('UNAUTHORIZED');
  });

  it('rejects empty membership', async () => {
    const org = await seedOrg(smoke.db);
    authBox.ctx = { userId: crypto.randomUUID(), orgId: org.id };
    expect((await actions.createPropertyGroup({}, form('X', []))).error?.code).toBe('VALIDATION_ERROR');
  });

  it('rejects properties from another org', async () => {
    const { db } = smoke;
    const org = await seedOrg(db);
    const other = await seedOrg(db, { name: 'Other' });
    const mine = await seedProperty(db, org.id);
    const foreign = await seedProperty(db, other.id);
    authBox.ctx = { userId: crypto.randomUUID(), orgId: org.id };

    expect((await actions.createPropertyGroup({}, form('Mix', [mine.id, foreign.id]))).error?.code).toBe('NOT_FOUND');
    expect(await listPropertyGroups(org.id)).toHaveLength(0);
  });

  it('creates a group with members, lists them and blocks duplicate names', async () => {
    const { db } = smoke;
    const org = await seedOrg(db);
    const a = await seedProperty(db, org.id, { name: 'Alpha' });
    const b = await seedProperty(db, org.id, { name: 'Beta' });
    authBox.ctx = { userId: crypto.randomUUID(), orgId: org.id };

    expect((await actions.createPropertyGroup({}, form(' Miraflores ', [a.id, b.id, a.id]))).error).toBeUndefined();
    expect((await actions.createPropertyGroup({}, form('Miraflores', [a.id]))).error?.code).toBe('CONFLICT');

    const groups = await listPropertyGroups(org.id);
    expect(groups).toHaveLength(1);
    expect(groups[0].name).toBe('Miraflores');
    expect(groups[0].members.map((m) => m.name).sort()).toEqual(['Alpha', 'Beta']);
  });
});

describe('removePropertyGroup', () => {
  it('deletes own groups only and cascades members', async () => {
    const { db } = smoke;
    const org = await seedOrg(db);
    const other = await seedOrg(db, { name: 'Other' });
    const p = await seedProperty(db, other.id);
    const [theirs] = await db.insert(schema.propertyGroups).values({ orgId: other.id, name: 'Ajeno' }).returning();
    await db.insert(schema.propertyGroupMembers).values({ groupId: theirs.id, propertyId: p.id });
    const [mine] = await db.insert(schema.propertyGroups).values({ orgId: org.id, name: 'Mío' }).returning();
    authBox.ctx = { userId: crypto.randomUUID(), orgId: org.id };

    expect((await actions.removePropertyGroup({}, idForm(theirs.id))).error?.code).toBe('NOT_FOUND');
    expect(await listPropertyGroups(other.id)).toHaveLength(1);

    expect((await actions.removePropertyGroup({}, idForm(mine.id))).error).toBeUndefined();
    expect(await listPropertyGroups(org.id)).toHaveLength(0);

    authBox.ctx = { userId: crypto.randomUUID(), orgId: other.id };
    expect((await actions.removePropertyGroup({}, idForm(theirs.id))).error).toBeUndefined();
    expect(await db.select().from(schema.propertyGroupMembers).where(eq(schema.propertyGroupMembers.groupId, theirs.id))).toHaveLength(0);
  });
});

function idForm(id: string): FormData {
  const fd = new FormData();
  fd.set('id', id);
  return fd;
}
