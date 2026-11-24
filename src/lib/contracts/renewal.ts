import { and, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { contracts } from '@/lib/db/schema';

const DAY_MS = 86_400_000;

const toDate = (iso: string) => new Date(`${iso}T00:00:00Z`);
const toIso = (date: Date) => date.toISOString().slice(0, 10);

function addMonths(iso: string, months: number): string {
  const date = toDate(iso);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, lastDay));
  return toIso(date);
}

export function renewalTerm(currentEnd: string | null, months: number, today: string) {
  const startDate = currentEnd ? toIso(new Date(toDate(currentEnd).getTime() + DAY_MS)) : today;
  const endDate = toIso(new Date(toDate(addMonths(startDate, months)).getTime() - DAY_MS));
  return { startDate, endDate };
}

export interface RenewContractInput {
  orgId: string;
  contractId: string;
  months: number;
  monthlyRent?: number;
  today: string;
}

export type RenewContractResult =
  | { status: 'not_found' }
  | { status: 'not_active' }
  | { status: 'done'; contractId: string };

export async function renewContract(input: RenewContractInput): Promise<RenewContractResult> {
  const scope = and(eq(contracts.id, input.contractId), eq(contracts.orgId, input.orgId));
  const [current] = await db
    .select({
      status: contracts.status,
      tenantId: contracts.tenantId,
      unitId: contracts.unitId,
      endDate: contracts.endDate,
      monthlyRent: contracts.monthlyRent,
      deposit: contracts.deposit,
      contractType: contracts.contractType,
    })
    .from(contracts)
    .where(scope)
    .limit(1);

  if (!current) return { status: 'not_found' };
  if (current.status !== 'active') return { status: 'not_active' };

  const { startDate, endDate } = renewalTerm(current.endDate, input.months, input.today);
  const contractId = crypto.randomUUID();
  const now = new Date();

  await db.batch([
    db.update(contracts).set({ status: 'expired', updatedAt: now }).where(scope),
    db.insert(contracts).values({
      id: contractId,
      orgId: input.orgId,
      tenantId: current.tenantId,
      unitId: current.unitId,
      startDate,
      endDate,
      monthlyRent: input.monthlyRent != null ? input.monthlyRent.toFixed(2) : current.monthlyRent,
      deposit: current.deposit,
      contractType: current.contractType,
      durationMonths: input.months,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    }),
  ]);

  return { status: 'done', contractId };
}
