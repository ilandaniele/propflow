import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { createSmokeDb, seedOrg, seedProfile, type SmokeDb } from './setup';
import { findClosedPeriod, insertPeriodClose, listPeriodCloses, removePeriodClose } from '@/lib/period-close/queries';
import { isUniqueViolation } from '@/lib/db/errors';

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

async function seedScenario() {
  const org = await seedOrg(smoke.db);
  const admin = await seedProfile(smoke.db, org.id, { role: 'admin', fullName: 'Ana Admin', email: `admin-${crypto.randomUUID()}@example.com` });
  return { org, admin };
}

describe('period close (real SQL)', () => {
  it('reports a closed period for any date inside it', async () => {
    const { org, admin } = await seedScenario();
    await insertPeriodClose({ orgId: org.id, period: '2026-03', closedBy: admin.id });

    expect(await findClosedPeriod(org.id, ['2026-03-31'])).toBe('2026-03');
    expect(await findClosedPeriod(org.id, ['2026-04-01', '2026-03-01'])).toBe('2026-03');
    expect(await findClosedPeriod(org.id, ['2026-04-01'])).toBeNull();
    expect(await findClosedPeriod(org.id, [null, ''])).toBeNull();
  });

  it('keeps closes per org', async () => {
    const { org, admin } = await seedScenario();
    const other = await seedOrg(smoke.db);
    await insertPeriodClose({ orgId: org.id, period: '2026-05', closedBy: admin.id });

    expect(await findClosedPeriod(other.id, ['2026-05-10'])).toBeNull();
    expect(await removePeriodClose(other.id, '2026-05')).toBe(false);
    expect(await findClosedPeriod(org.id, ['2026-05-10'])).toBe('2026-05');
  });

  it('rejects closing the same month twice', async () => {
    const { org, admin } = await seedScenario();
    await insertPeriodClose({ orgId: org.id, period: '2026-06', closedBy: admin.id });
    const error = await insertPeriodClose({ orgId: org.id, period: '2026-06', closedBy: admin.id }).catch((e: unknown) => e);
    expect(isUniqueViolation(error)).toBe(true);
  });

  it('lists newest first with the closer name and reopens', async () => {
    const { org, admin } = await seedScenario();
    await insertPeriodClose({ orgId: org.id, period: '2026-01', closedBy: admin.id });
    await insertPeriodClose({ orgId: org.id, period: '2026-02', closedBy: admin.id, note: 'Bank ok' });

    const list = await listPeriodCloses(org.id);
    expect(list.map((c) => c.period)).toEqual(['2026-02', '2026-01']);
    expect(list[0]).toMatchObject({ note: 'Bank ok', closedByName: 'Ana Admin' });

    expect(await removePeriodClose(org.id, '2026-02')).toBe(true);
    expect(await findClosedPeriod(org.id, ['2026-02-15'])).toBeNull();
  });
});
