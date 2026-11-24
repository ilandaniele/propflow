import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { createSmokeDb, seedOrg, seedProperty, type SmokeDb } from './setup';

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

describe('building staff (real SQL)', () => {
  it('lists staff scoped by org, and the tenant directory hides phone and document', async () => {
    const { insertStaffMember, listStaff, listStaffDirectory, propertyBelongsToOrg } = await import('@/lib/staff/queries');
    const org = await seedOrg(smoke.db);
    const other = await seedOrg(smoke.db);
    const property = await seedProperty(smoke.db, org.id, { name: 'Torre A' });
    const foreign = await seedProperty(smoke.db, other.id);

    await insertStaffMember({ orgId: org.id, propertyId: property.id, fullName: 'Bea', position: 'Seguridad', shift: 'Noche', phone: '999', documentNumber: '123' });
    await insertStaffMember({ orgId: org.id, fullName: 'Ana', position: 'Portera' });
    await insertStaffMember({ orgId: other.id, fullName: 'Zed', position: 'Portero' });

    const admin = await listStaff(org.id);
    expect(admin.map((r) => r.fullName)).toEqual(['Ana', 'Bea']);
    expect(admin[1]).toMatchObject({ propertyName: 'Torre A', phone: '999', documentNumber: '123' });

    const directory = await listStaffDirectory(org.id);
    expect(directory[1]).toEqual({ id: admin[1].id, fullName: 'Bea', position: 'Seguridad', shift: 'Noche', propertyName: 'Torre A' });

    expect(await propertyBelongsToOrg(org.id, property.id)).toBe(true);
    expect(await propertyBelongsToOrg(org.id, foreign.id)).toBe(false);
  });

  it('deletes only within the org', async () => {
    const { insertStaffMember, listStaff, deleteStaffMember } = await import('@/lib/staff/queries');
    const org = await seedOrg(smoke.db);
    const other = await seedOrg(smoke.db);
    await insertStaffMember({ orgId: org.id, fullName: 'Ana', position: 'Portera' });
    const [row] = await listStaff(org.id);

    expect(await deleteStaffMember(other.id, row.id)).toBe(false);
    expect(await listStaff(org.id)).toHaveLength(1);
    expect(await deleteStaffMember(org.id, row.id)).toBe(true);
    expect(await listStaff(org.id)).toHaveLength(0);
  });
});
