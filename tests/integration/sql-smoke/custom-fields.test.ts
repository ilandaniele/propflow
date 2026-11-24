import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import * as schema from '@/lib/db/schema';
import { createSmokeDb, seedOrg, seedProperty, seedUnit, type SmokeDb } from './setup';

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

const { listDefinitions, listEntityFieldValues } = await import('@/lib/custom-fields/queries');
const actions = await import('@/app/actions/custom-fields');

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

function form(entries: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.set(k, v);
  return fd;
}

async function adminOrg() {
  const org = await seedOrg(smoke.db);
  authBox.ctx = { userId: crypto.randomUUID(), orgId: org.id };
  return org;
}

let sortOrder = 0;

async function define(entityType: string, key: string, fieldType: string, extra: Record<string, string> = {}) {
  sortOrder += 1;
  const fields = { entity_type: entityType, key, field_type: fieldType, label: key, sort_order: String(sortOrder), ...extra };
  const result = await actions.createCustomFieldDefinition({}, form(fields));
  expect(result.error).toBeUndefined();
}

describe('custom field actions', () => {
  it('reject anonymous callers', async () => {
    const id = crypto.randomUUID();
    expect((await actions.createCustomFieldDefinition({}, form({}))).error?.code).toBe('UNAUTHORIZED');
    expect((await actions.updateCustomFieldDefinition({}, form({ id, label: 'x' }))).error?.code).toBe('UNAUTHORIZED');
    expect((await actions.removeCustomFieldDefinition({}, form({ id }))).error?.code).toBe('UNAUTHORIZED');
    expect((await actions.saveCustomFieldValues({}, form({ entity_type: 'unit', entity_id: id }))).error?.code).toBe('UNAUTHORIZED');
  });

  it('creates definitions, blocks duplicate keys and keeps orgs apart', async () => {
    const org = await adminOrg();
    await define('property', 'zone', 'select', { options: 'Norte\nSur', required: 'on' });
    expect((await actions.createCustomFieldDefinition({}, form({ entity_type: 'property', key: 'zone', field_type: 'text', label: 'Z' }))).error?.code).toBe('CONFLICT');
    await define('unit', 'zone', 'text');

    const defs = await listDefinitions(org.id);
    expect(defs.map((d) => [d.entityType, d.key, d.fieldType])).toEqual([['property', 'zone', 'select'], ['unit', 'zone', 'text']]);
    expect(defs[0]).toMatchObject({ required: true, options: ['Norte', 'Sur'] });

    await adminOrg();
    expect((await actions.updateCustomFieldDefinition({}, form({ id: defs[0].id, label: 'Hack' }))).error?.code).toBe('NOT_FOUND');
    expect((await actions.removeCustomFieldDefinition({}, form({ id: defs[0].id }))).error?.code).toBe('NOT_FOUND');
    expect((await listDefinitions(org.id))[0].label).toBe('zone');
  });

  it('updates label, flags and options but not key or type', async () => {
    const org = await adminOrg();
    await define('unit', 'view', 'select', { options: 'Mar' });
    const [d] = await listDefinitions(org.id);

    expect((await actions.updateCustomFieldDefinition({}, form({ id: d.id, label: 'Vista', options: '' }))).error?.code).toBe('VALIDATION_ERROR');
    expect((await actions.updateCustomFieldDefinition({}, form({ id: d.id, label: 'Vista', sort_order: '5', options: 'Mar\nParque', field_type: 'text' }))).error).toBeUndefined();

    const [updated] = await listDefinitions(org.id);
    expect(updated).toMatchObject({ key: 'view', fieldType: 'select', label: 'Vista', sortOrder: 5, options: ['Mar', 'Parque'], required: false });
  });

  it('saves values for own entities only, upserts and clears', async () => {
    const { db } = smoke;
    const org = await adminOrg();
    const property = await seedProperty(db, org.id);
    const unit = await seedUnit(db, org.id, property.id);
    await define('unit', 'parking', 'boolean');
    await define('unit', 'meter', 'text');
    await define('unit', 'area', 'number', { required: 'on' });
    const [parking, meter, area] = await listDefinitions(org.id);

    const values = (extra: Record<string, string>) => form({ entity_type: 'unit', entity_id: unit.id, ...extra });
    const missing = await actions.saveCustomFieldValues({}, values({}));
    expect(missing.error?.code).toBe('VALIDATION_ERROR');
    expect(missing.error?.details).toEqual({ fieldErrors: { [area.id]: ['required'] } });

    expect((await actions.saveCustomFieldValues({}, values({ [`field_${parking.id}`]: 'on', [`field_${meter.id}`]: 'M-1', [`field_${area.id}`]: '45.50' }))).error).toBeUndefined();
    expect((await listEntityFieldValues(org.id, 'unit', unit.id)).map((f) => f.value)).toEqual(['true', 'M-1', '45.5']);

    expect((await actions.saveCustomFieldValues({}, values({ [`field_${area.id}`]: '50' }))).error).toBeUndefined();
    expect((await listEntityFieldValues(org.id, 'unit', unit.id)).map((f) => f.value)).toEqual(['false', null, '50']);
    expect(await db.select().from(schema.customFieldValues).where(eq(schema.customFieldValues.entityId, unit.id))).toHaveLength(2);

    const other = await seedOrg(db, { name: 'Other' });
    const foreignProperty = await seedProperty(db, other.id);
    const foreignUnit = await seedUnit(db, other.id, foreignProperty.id);
    expect((await actions.saveCustomFieldValues({}, form({ entity_type: 'unit', entity_id: foreignUnit.id, [`field_${area.id}`]: '1' }))).error?.code).toBe('NOT_FOUND');
    expect((await actions.saveCustomFieldValues({}, form({ entity_type: 'property', entity_id: unit.id }))).error?.code).toBe('NOT_FOUND');
  });

  it('cascades values on definition delete and cleans up on entity delete', async () => {
    const { db } = smoke;
    const org = await adminOrg();
    const property = await seedProperty(db, org.id);
    await define('property', 'notes', 'text');
    await define('property', 'built', 'date');
    const [notes, built] = await listDefinitions(org.id);

    const save = form({ entity_type: 'property', entity_id: property.id, [`field_${notes.id}`]: 'hola', [`field_${built.id}`]: '2020-01-31' });
    expect((await actions.saveCustomFieldValues({}, save)).error).toBeUndefined();
    const stored = () => db.select().from(schema.customFieldValues).where(eq(schema.customFieldValues.entityId, property.id));
    expect(await stored()).toHaveLength(2);

    expect((await actions.removeCustomFieldDefinition({}, form({ id: notes.id }))).error).toBeUndefined();
    expect(await stored()).toHaveLength(1);

    await db.delete(schema.properties).where(eq(schema.properties.id, property.id));
    expect(await stored()).toHaveLength(0);
  });

  it('enforces one value per definition and entity', async () => {
    const { db } = smoke;
    const org = await adminOrg();
    await define('tenant', 'nickname', 'text');
    const [d] = await listDefinitions(org.id);
    const entityId = crypto.randomUUID();
    await db.insert(schema.customFieldValues).values({ orgId: org.id, definitionId: d.id, entityId, value: 'a' });
    await expect(db.insert(schema.customFieldValues).values({ orgId: org.id, definitionId: d.id, entityId, value: 'b' })).rejects.toThrow();
  });
});
