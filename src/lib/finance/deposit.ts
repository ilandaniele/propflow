import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { contracts, depositMovements, DEPOSIT_MOVEMENT_KINDS } from '@/lib/db/schema';

export type DepositMovementKind = (typeof DEPOSIT_MOVEMENT_KINDS)[number];

export interface DepositTotals {
  collected: number;
  deducted: number;
  refunded: number;
}

const cents = (value: number) => Math.round(value * 100) / 100;

export function heldDeposit(totals: DepositTotals): number {
  return cents(totals.collected - totals.deducted - totals.refunded);
}

export function canRecord(kind: DepositMovementKind, amount: number, totals: DepositTotals): boolean {
  return kind === 'collected' || amount <= heldDeposit(totals);
}

const sumOf = (kind: DepositMovementKind) =>
  sql<number>`COALESCE(SUM(CASE WHEN ${depositMovements.kind} = ${kind} THEN CAST(${depositMovements.amount} AS REAL) END), 0)`;

export const depositTotalsColumns = {
  collected: sumOf('collected'),
  deducted: sumOf('deduction'),
  refunded: sumOf('refund'),
};

export interface DepositMovementInput {
  orgId: string;
  contractId: string;
  kind: DepositMovementKind;
  amount: number;
  movedOn: string;
  description?: string;
  createdBy: string;
}

export type RecordDepositResult = 'not_found' | 'exceeds_balance' | 'done';

export async function recordDepositMovement(input: DepositMovementInput): Promise<RecordDepositResult> {
  const [contract] = await db
    .select({ id: contracts.id, ...depositTotalsColumns })
    .from(contracts)
    .leftJoin(depositMovements, and(eq(depositMovements.contractId, contracts.id), eq(depositMovements.orgId, input.orgId)))
    .where(and(eq(contracts.id, input.contractId), eq(contracts.orgId, input.orgId)))
    .groupBy(contracts.id);

  if (!contract) return 'not_found';
  if (!canRecord(input.kind, input.amount, contract)) return 'exceeds_balance';

  const insert = db.insert(depositMovements).values({
    orgId: input.orgId,
    contractId: input.contractId,
    kind: input.kind,
    amount: input.amount.toFixed(2),
    movedOn: input.movedOn,
    description: input.description ?? null,
    createdBy: input.createdBy,
  });

  if (input.kind !== 'refund') {
    await insert;
    return 'done';
  }

  const refunded = cents(Number(contract.refunded) + input.amount).toFixed(2);
  await db.batch([
    insert,
    db.update(contracts).set({ depositReturned: refunded, updatedAt: new Date() })
      .where(and(eq(contracts.id, input.contractId), eq(contracts.orgId, input.orgId))),
  ]);
  return 'done';
}
