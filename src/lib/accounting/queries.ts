import { and, asc, eq, gte, lt, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { expenseCategories, expenses, payments, tenants } from '@/lib/db/schema';
import type { JournalExpense, JournalPayment } from './journal';

export function monthRange(month: string): { start: string; end: string } {
  const [year, mon] = month.split('-').map(Number);
  const next = mon === 12 ? `${year + 1}-01` : `${year}-${String(mon + 1).padStart(2, '0')}`;
  return { start: `${month}-01`, end: `${next}-01` };
}

export async function journalSource(orgId: string, month: string): Promise<{ payments: JournalPayment[]; expenses: JournalExpense[] }> {
  const { start, end } = monthRange(month);
  const [paymentRows, expenseRows] = await Promise.all([
    db
      .select({
        id: payments.id,
        paidAt: payments.paidAt,
        amount: payments.amount,
        currency: payments.currency,
        method: payments.method,
        tenantName: sql<string | null>`coalesce(${tenants.fullName}, ${payments.tenantName})`,
        reference: payments.reference,
      })
      .from(payments)
      .leftJoin(tenants, eq(tenants.id, payments.tenantId))
      .where(and(eq(payments.orgId, orgId), eq(payments.status, 'approved'), gte(payments.paidAt, start), lt(payments.paidAt, end)))
      .orderBy(asc(payments.paidAt)),
    db
      .select({
        id: expenses.id,
        incurredOn: expenses.incurredOn,
        amount: expenses.amount,
        description: expenses.description,
        categoryName: expenseCategories.name,
      })
      .from(expenses)
      .leftJoin(expenseCategories, eq(expenseCategories.id, expenses.categoryId))
      .where(and(eq(expenses.orgId, orgId), gte(expenses.incurredOn, start), lt(expenses.incurredOn, end)))
      .orderBy(asc(expenses.incurredOn)),
  ]);
  return { payments: paymentRows, expenses: expenseRows };
}
