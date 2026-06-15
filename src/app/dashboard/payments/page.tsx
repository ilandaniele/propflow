import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { payments, contracts, tenants } from '@/lib/db/schema';
import { eq, desc, and } from 'drizzle-orm';
import { requireAdmin } from '@/lib/auth/guards';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { StatusPill } from '@/components/ui/Badge';
import { ApprovePaymentButton } from './ApprovePaymentButton';
import { CreateChargeForm } from './CreateChargeForm';
import { AdminPaymentsCsvButtons } from './AdminPaymentsCsvButtons';

export const metadata: Metadata = { title: 'Payments' };

export default async function PaymentsPage() {
  let ctx;
  try { ctx = await requireAdmin(); } catch { redirect('/login'); }

  const [paymentRows, contractRows, tenantRows] = await Promise.all([
    db.select({
      id: payments.id,
      tenantId: payments.tenantId,
      amount: payments.amount,
      paidAt: payments.paidAt,
      method: payments.method,
      status: payments.status,
      createdAt: payments.createdAt,
    })
      .from(payments)
      .where(eq(payments.orgId, ctx.orgId))
      .orderBy(desc(payments.createdAt))
      .limit(50),
    db.select({
      id: contracts.id,
      monthlyRent: contracts.monthlyRent,
      tenantId: contracts.tenantId,
    })
      .from(contracts)
      .where(and(eq(contracts.orgId, ctx.orgId), eq(contracts.status, 'active'))),
    db.select({ id: tenants.id, fullName: tenants.fullName })
      .from(tenants)
      .where(eq(tenants.orgId, ctx.orgId)),
  ]);

  const tenantMap = new Map(tenantRows.map((t) => [t.id, t.fullName]));

  const pendingCount = paymentRows.filter((p) => p.status === 'pending').length;

  // Shape contracts for CreateChargeForm prop compatibility
  const contractsForForm = contractRows.map((c) => ({
    id: c.id,
    monthly_rent: Number(c.monthlyRent),
    tenant_id: c.tenantId,
    tenants: { full_name: tenantMap.get(c.tenantId) ?? null },
  }));

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Payments</h1>
          {pendingCount > 0 && (
            <p className="text-sm text-amber-600 font-medium mt-1">{pendingCount} pending approval</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <AdminPaymentsCsvButtons />
          <CreateChargeForm contracts={contractsForForm as unknown as Array<{ id: string; monthly_rent: number; tenant_id: string; tenants: { full_name: string } | null }>} />
        </div>
      </div>

      {paymentRows.length === 0 ? (
        <Card>
          <EmptyState
            title="No payments yet"
            description="Tenants can record payments from their portal, or you can create charges here."
          />
        </Card>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full" aria-label="Payments list">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Tenant</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Amount</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden sm:table-cell">Date</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden md:table-cell">Method</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Status</th>
                <th className="text-right px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {paymentRows.map((payment) => {
                const tenantName = tenantMap.get(payment.tenantId) ?? '—';
                return (
                  <tr key={payment.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-5 py-4 text-sm font-medium text-slate-900">{tenantName}</td>
                    <td className="px-5 py-4 text-sm font-semibold text-slate-900">${Number(payment.amount).toLocaleString()}</td>
                    <td className="px-5 py-4 text-sm text-slate-500 hidden sm:table-cell">{payment.paidAt}</td>
                    <td className="px-5 py-4 text-sm text-slate-500 capitalize hidden md:table-cell">{payment.method}</td>
                    <td className="px-5 py-4"><StatusPill status={payment.status} /></td>
                    <td className="px-5 py-4 text-right">
                      {payment.status === 'pending' && (
                        <ApprovePaymentButton paymentId={payment.id} />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
