import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/auth/guards';
import { getTranslations } from 'next-intl/server';
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

  const supabase = await createClient();
  const t = await getTranslations('payments');

  const [paymentsRes, contractsRes] = await Promise.all([
    supabase.from('payments').select('*, tenants(full_name)').eq('org_id', ctx.orgId).order('created_at', { ascending: false }).limit(50),
    supabase.from('contracts').select('id, monthly_rent, tenant_id, tenants(full_name)').eq('org_id', ctx.orgId).eq('status', 'active'),
  ]);

  const payments = paymentsRes.data ?? [];
  const contracts = contractsRes.data ?? [];

  const pendingCount = payments.filter((p) => p.status === 'pending').length;

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{t('title')}</h1>
          {pendingCount > 0 && (
            <p className="text-sm text-amber-600 font-medium mt-1">
              {t('list.pendingApproval', { count: pendingCount })}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <AdminPaymentsCsvButtons />
          <CreateChargeForm contracts={contracts as unknown as Array<{ id: string; monthly_rent: number; tenant_id: string; tenants: { full_name: string } | null }>} />
        </div>
      </div>

      {payments.length === 0 ? (
        <Card>
          <EmptyState
            title={t('list.emptyTitle')}
            description={t('list.emptyDesc')}
          />
        </Card>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full" aria-label={t('title')}>
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">{t('list.colTenant')}</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">{t('list.colAmount')}</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden sm:table-cell">{t('list.colDate')}</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden md:table-cell">{t('list.colMethod')}</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">{t('list.colStatus')}</th>
                <th className="text-right px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">{t('list.colAction')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {payments.map((payment) => {
                const tenant = payment.tenants as { full_name: string } | null;
                return (
                  <tr key={payment.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-5 py-4 text-sm font-medium text-slate-900">{tenant?.full_name ?? '—'}</td>
                    <td className="px-5 py-4 text-sm font-semibold text-slate-900">
                      S/ {Number(payment.amount).toLocaleString('es-PE', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="px-5 py-4 text-sm text-slate-500 hidden sm:table-cell">{payment.paid_at}</td>
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
