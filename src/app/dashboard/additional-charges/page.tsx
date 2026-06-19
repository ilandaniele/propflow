import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/auth/guards';
import { getTranslations } from 'next-intl/server';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';

export const metadata: Metadata = { title: 'Additional Charges' };

export default async function AdditionalChargesPage() {
  let ctx;
  try { ctx = await requireAdmin(); } catch { redirect('/login'); }

  const supabase = await createClient();
  const t = await getTranslations('additionalCharges');
  const { data: charges } = await supabase
    .from('additional_charges')
    .select('*, contracts(id, tenants(full_name))')
    .eq('org_id', ctx.orgId)
    .order('anio', { ascending: false })
    .order('mes', { ascending: false })
    .limit(100);

  const rows = charges ?? [];
  const totalAmount = rows.reduce((sum, r) => sum + (r.amount ?? 0), 0);

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{t('title')}</h1>
          <p className="text-sm text-slate-500 mt-1">
            {t('subtitle', { count: rows.length, total: totalAmount.toLocaleString('es-PE', { minimumFractionDigits: 2 }) })}
          </p>
        </div>
      </div>

      {rows.length === 0 ? (
        <Card>
          <EmptyState
            title={t('emptyTitle')}
            description={t('emptyDesc')}
          />
        </Card>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full" aria-label={t('title')}>
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">{t('colTenant')}</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden sm:table-cell">{t('colPeriod')}</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">{t('colAmount')}</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden md:table-cell">{t('colDescription')}</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden lg:table-cell">{t('colNumber')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((charge) => {
                const contract = charge.contracts as { tenants: { full_name: string } | null } | null;
                const tenantName = contract?.tenants?.full_name ?? '—';
                const period = charge.mes && charge.anio ? `${charge.mes} ${charge.anio}` : '—';
                return (
                  <tr key={charge.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-5 py-4 text-sm font-medium text-slate-900">{tenantName}</td>
                    <td className="px-5 py-4 text-sm text-slate-500 hidden sm:table-cell">{period}</td>
                    <td className="px-5 py-4 text-sm font-semibold text-slate-900">
                      S/ {(charge.amount ?? 0).toLocaleString('es-PE', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="px-5 py-4 text-sm text-slate-500 hidden md:table-cell max-w-xs truncate">
                      {charge.description ?? '—'}
                    </td>
                    <td className="px-5 py-4 text-sm text-slate-400 hidden lg:table-cell">{charge.numero ?? '—'}</td>
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
