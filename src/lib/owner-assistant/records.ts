import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { contracts, expenses, payments, tenants } from '@/lib/db/schema';

const LIMA_DATE = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima', year: 'numeric', month: '2-digit', day: '2-digit' });

export function todayInLima(now = new Date()): string {
  return LIMA_DATE.format(now);
}

export async function recordExpense(
  orgId: string,
  input: { amount: number; description: string; receiptPath?: string | null; incurredOn?: string },
): Promise<string> {
  const [row] = await db
    .insert(expenses)
    .values({
      orgId,
      amount: input.amount.toFixed(2),
      description: input.description,
      incurredOn: input.incurredOn ?? todayInLima(),
      receiptPath: input.receiptPath ?? null,
    })
    .returning({ id: expenses.id });
  return row.id;
}

export interface PaymentCandidate {
  tenantId: string;
  contractId: string;
  fullName: string;
}

/** Tenants with an active contract whose name contains the query (case-insensitive). At most 3, enough to tell "one match" from "ambiguous". */
export async function findPaymentCandidates(orgId: string, query: string): Promise<PaymentCandidate[]> {
  const pattern = `%${query.toLowerCase().replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
  return db
    .select({ tenantId: tenants.id, contractId: contracts.id, fullName: tenants.fullName })
    .from(contracts)
    .innerJoin(tenants, eq(tenants.id, contracts.tenantId))
    .where(and(
      eq(contracts.orgId, orgId),
      eq(tenants.orgId, orgId),
      eq(contracts.status, 'active'),
      sql`lower(${tenants.fullName}) LIKE ${pattern} ESCAPE '\\'`,
    ))
    .limit(3);
}

export async function recordApprovedPayment(
  orgId: string,
  approverProfileId: string,
  candidate: PaymentCandidate,
  amount: number,
): Promise<string> {
  const now = new Date();
  const [row] = await db
    .insert(payments)
    .values({
      orgId,
      contractId: candidate.contractId,
      tenantId: candidate.tenantId,
      amount: amount.toFixed(2),
      paidAt: todayInLima(now),
      method: 'other',
      status: 'approved',
      approvedBy: approverProfileId,
      approvedAt: now,
      reference: 'WhatsApp',
    })
    .returning({ id: payments.id });
  return row.id;
}
