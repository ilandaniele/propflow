import { and, asc, eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { cashAccounts, cashMovements } from '@/lib/db/schema';
import type { CashAccountInput, CashMovementInput } from '@/lib/schemas/cash-account';
import type { MonthTotals } from './cash-ledger-math';

export type CreateCashAccountResult = { status: 'duplicate' } | { status: 'done'; accountId: string };
export type AddCashMovementResult = { status: 'not_found' } | { status: 'inactive' } | { status: 'done' };

export async function createCashAccount(orgId: string, input: CashAccountInput): Promise<CreateCashAccountResult> {
  const [existing] = await db
    .select({ id: cashAccounts.id })
    .from(cashAccounts)
    .where(and(eq(cashAccounts.orgId, orgId), eq(cashAccounts.name, input.name)))
    .limit(1);
  if (existing) return { status: 'duplicate' };

  const now = new Date();
  const [row] = await db.insert(cashAccounts).values({
    orgId,
    name: input.name,
    kind: input.kind,
    bankName: input.kind === 'bank' ? input.bank_name ?? null : null,
    accountNumber: input.kind === 'bank' ? input.account_number ?? null : null,
    openingBalance: input.opening_balance.toFixed(2),
    createdAt: now,
    updatedAt: now,
  }).returning({ id: cashAccounts.id });
  return { status: 'done', accountId: row.id };
}

export async function addCashMovement(
  orgId: string,
  createdBy: string,
  input: CashMovementInput,
): Promise<AddCashMovementResult> {
  const [account] = await db
    .select({ active: cashAccounts.active })
    .from(cashAccounts)
    .where(and(eq(cashAccounts.id, input.account_id), eq(cashAccounts.orgId, orgId)))
    .limit(1);
  if (!account) return { status: 'not_found' };
  if (!account.active) return { status: 'inactive' };

  const now = new Date();
  await db.insert(cashMovements).values({
    orgId,
    accountId: input.account_id,
    occurredOn: input.occurred_on,
    concept: input.concept,
    document: input.document ?? null,
    direction: input.direction,
    amount: input.amount.toFixed(2),
    createdBy,
    createdAt: now,
    updatedAt: now,
  });
  return { status: 'done' };
}

const signedSum = (direction: 'in' | 'out') =>
  sql<number>`coalesce(sum(case when ${cashMovements.direction} = ${direction} then cast(${cashMovements.amount} as real) end), 0)`;

export async function monthlyTotalsByAccount(orgId: string, accountId?: string): Promise<Map<string, MonthTotals[]>> {
  const month = sql<string>`substr(${cashMovements.occurredOn}, 1, 7)`;
  const rows = await db
    .select({ accountId: cashMovements.accountId, month, income: signedSum('in'), outflow: signedSum('out') })
    .from(cashMovements)
    .where(and(eq(cashMovements.orgId, orgId), accountId ? eq(cashMovements.accountId, accountId) : undefined))
    .groupBy(cashMovements.accountId, month)
    .orderBy(asc(month));

  const byAccount = new Map<string, MonthTotals[]>();
  for (const row of rows) {
    const list = byAccount.get(row.accountId) ?? [];
    list.push({ month: row.month, income: Number(row.income), outflow: Number(row.outflow) });
    byAccount.set(row.accountId, list);
  }
  return byAccount;
}

export function listCashAccounts(orgId: string) {
  return db
    .select({
      id: cashAccounts.id,
      name: cashAccounts.name,
      kind: cashAccounts.kind,
      bankName: cashAccounts.bankName,
      accountNumber: cashAccounts.accountNumber,
      openingBalance: cashAccounts.openingBalance,
      active: cashAccounts.active,
    })
    .from(cashAccounts)
    .where(eq(cashAccounts.orgId, orgId))
    .orderBy(asc(cashAccounts.name))
    .limit(100);
}

export function listMonthMovements(orgId: string, accountId: string, month: string) {
  return db
    .select({
      id: cashMovements.id,
      occurredOn: cashMovements.occurredOn,
      concept: cashMovements.concept,
      document: cashMovements.document,
      direction: cashMovements.direction,
      amount: cashMovements.amount,
    })
    .from(cashMovements)
    .where(and(
      eq(cashMovements.orgId, orgId),
      eq(cashMovements.accountId, accountId),
      sql`substr(${cashMovements.occurredOn}, 1, 7) = ${month}`,
    ))
    .orderBy(asc(cashMovements.occurredOn), asc(cashMovements.createdAt))
    .limit(1000);
}
