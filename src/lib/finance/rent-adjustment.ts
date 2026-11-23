import { and, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { contracts, rentAdjustments } from '@/lib/db/schema';
import { adjustedRent } from './rent-adjustment-math';

export interface RentAdjustmentInput {
  orgId: string;
  contractId: string;
  percent: number;
  effectiveOn: string;
  createdBy: string;
}

export type RentAdjustmentResult =
  | { status: 'not_found' }
  | { status: 'not_active' }
  | { status: 'done'; newRent: string };

export async function applyRentAdjustment(input: RentAdjustmentInput): Promise<RentAdjustmentResult> {
  const scope = and(eq(contracts.id, input.contractId), eq(contracts.orgId, input.orgId));
  const [contract] = await db
    .select({ status: contracts.status, monthlyRent: contracts.monthlyRent })
    .from(contracts)
    .where(scope)
    .limit(1);

  if (!contract) return { status: 'not_found' };
  if (contract.status !== 'active') return { status: 'not_active' };

  const newRent = adjustedRent(Number(contract.monthlyRent), input.percent).toFixed(2);
  const now = new Date();
  await db.batch([
    db.insert(rentAdjustments).values({
      orgId: input.orgId,
      contractId: input.contractId,
      previousRent: contract.monthlyRent,
      newRent,
      percent: input.percent.toFixed(2),
      effectiveOn: input.effectiveOn,
      createdBy: input.createdBy,
      createdAt: now,
      updatedAt: now,
    }),
    db.update(contracts).set({ monthlyRent: newRent, updatedAt: now }).where(scope),
  ]);
  return { status: 'done', newRent };
}
