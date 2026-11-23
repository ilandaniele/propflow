import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import * as schema from '@/lib/db/schema';
import { createSmokeDb, seedOrg, seedProfile, type SmokeDb } from './setup';

const auth = vi.hoisted(() => ({ ctx: { userId: 'admin-1', orgId: '', role: 'admin', profile: { id: '' } } }));
vi.mock('@/lib/auth/guards', () => ({ requireAdmin: vi.fn(async () => auth.ctx) }));
vi.mock('@/lib/ratelimit', () => ({ mutationRateLimit: vi.fn(() => ({ success: true })) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { addCashMovement, createCashAccount } from '@/app/actions/cash-accounts';
import { buildAnnualLiquidationCsv, buildMonthMovementsCsv } from '@/lib/finance/cash-export';

let smoke: { db: SmokeDb; close: () => Promise<void> };
let db: SmokeDb;

beforeAll(async () => {
  smoke = await createSmokeDb();
  db = smoke.db;
});

afterAll(async () => {
  await smoke.close();
});

async function signIn() {
  const org = await seedOrg(db);
  const profile = await seedProfile(db, org.id);
  auth.ctx.orgId = org.id;
  auth.ctx.profile.id = profile.id;
  return org;
}

function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

async function newAccount(name = 'BCP soles') {
  const result = await createCashAccount(null, form({
    name, kind: 'bank', bank_name: 'BCP', account_number: '191-1', opening_balance: '100',
  }));
  expect(result.error).toBeUndefined();
  return result.data!.accountId;
}

const move = (accountId: string, direction: string, amount: string, occurredOn: string, concept = 'Renta') =>
  addCashMovement(null, form({ account_id: accountId, direction, amount, occurred_on: occurredOn, concept }));

describe('cash accounts (real SQL)', () => {
  it('creates an account and rejects duplicate names', async () => {
    const org = await signIn();
    const accountId = await newAccount();

    const [row] = await db.select().from(schema.cashAccounts).where(eq(schema.cashAccounts.id, accountId));
    expect(row).toMatchObject({ orgId: org.id, kind: 'bank', bankName: 'BCP', active: true });
    expect(Number(row.openingBalance)).toBe(100);

    const duplicate = await createCashAccount(null, form({ name: 'BCP soles', kind: 'cash', opening_balance: '0' }));
    expect(duplicate.error?.code).toBe('CONFLICT');
  });

  it('records movements and builds monthly and annual exports', async () => {
    await signIn();
    const accountId = await newAccount();
    expect((await move(accountId, 'in', '850', '2026-01-05')).error).toBeUndefined();
    expect((await move(accountId, 'out', '120.50', '2026-01-20', 'Luz, agua')).error).toBeUndefined();
    expect((await move(accountId, 'in', '850', '2026-02-05')).error).toBeUndefined();

    const month = await buildMonthMovementsCsv(auth.ctx.orgId, accountId, '2026-01');
    expect(month).toBe(
      '﻿fecha,concepto,documento,ingreso,egreso,saldo\r\n'
      + '2026-01-05,Renta,,850.00,,950.00\r\n'
      + '2026-01-20,"Luz, agua",,,120.50,829.50\r\n',
    );

    const annual = await buildAnnualLiquidationCsv(auth.ctx.orgId, 2026);
    const lines = annual.trim().split('\r\n');
    expect(lines).toHaveLength(13);
    expect(lines[1]).toBe('BCP soles,2026-01,100.00,850.00,120.50,829.50');
    expect(lines[2]).toBe('BCP soles,2026-02,829.50,850.00,0.00,1679.50');
    expect(lines[12]).toBe('BCP soles,2026-12,1679.50,0.00,0.00,1679.50');
  });

  it('refuses movements on accounts of another org', async () => {
    await signIn();
    const foreignAccount = await newAccount('Caja chica');
    await signIn();

    expect((await move(foreignAccount, 'in', '10', '2026-01-01')).error?.code).toBe('NOT_FOUND');
    expect(await buildMonthMovementsCsv(auth.ctx.orgId, foreignAccount, '2026-01')).toBeNull();
  });

  it('refuses movements on inactive accounts and invalid input', async () => {
    await signIn();
    const accountId = await newAccount();
    await db.update(schema.cashAccounts).set({ active: false }).where(eq(schema.cashAccounts.id, accountId));

    expect((await move(accountId, 'in', '10', '2026-01-01')).error?.code).toBe('INACTIVE');
    expect((await move(accountId, 'in', '0', '2026-01-01')).error?.code).toBe('VALIDATION_ERROR');
    expect((await move(accountId, 'sideways', '10', '2026-01-01')).error?.code).toBe('VALIDATION_ERROR');
  });
});
