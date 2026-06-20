import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/auth/guards';
import { getTranslations } from 'next-intl/server';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { StatusPill } from '@/components/ui/Badge';
import { CreateContractForm } from './CreateContractForm';

export const metadata: Metadata = { title: 'Contracts' };

export default async function ContractsPage() {
  let ctx;
  try { ctx = await requireAdmin(); } catch { redirect('/login'); }

  const [supabase, t] = await Promise.all([createClient(), getTranslations('contracts')]);

  const [contractsRes, tenantsRes, unitsRes] = await Promise.all([
    supabase.from('contracts').select('*, tenants(full_name), units(label, properties(name))').eq('org_id', ctx.orgId).order('created_at', { ascending: false }),
    supabase.from('tenants').select('id, full_name').eq('org_id', ctx.orgId),
    supabase.from('units').select('id, label, property_id, properties(name)').eq('org_id', ctx.orgId),
  ]);

  const contracts = contractsRes.data ?? [];
  const tenants = tenantsRes.data ?? [];
  const units = unitsRes.data ?? [];

  // Analytics
  const now = new Date();
  const in30Days = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const in60Days = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const today = now.toISOString().slice(0, 10);

  const active = contracts.filter((c) => c.status === 'active');
  const expiringSoon = active.filter((c) => c.end_date && c.end_date >= today && c.end_date <= in30Days);
  const expiringIn60 = active.filter((c) => c.end_date && c.end_date > in30Days && c.end_date <= in60Days);
  const totalMonthlyRent = active.reduce((s, c) => s + Number(c.monthly_rent), 0);

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{t('title')}</h1>
          <p className="text-sm text-slate-500 mt-1">{contracts.length} total · {active.length} {t('kpi.active')}</p>
        </div>
        <CreateContractForm tenants={tenants} units={units as unknown as Array<{ id: string; label: string; property_id: string; properties: { name: string } | null }>} />
      </div>

      {/* KPI tiles */}
      {contracts.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">{t('kpi.monthlyRent')}</p>
            <p className="text-xl font-bold text-slate-900">S/ {totalMonthlyRent.toLocaleString('es-PE', { minimumFractionDigits: 2 })}</p>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">{t('kpi.active')}</p>
            <p className="text-xl font-bold text-slate-900">{active.length}</p>
          </div>
          <div className={`rounded-xl border p-4 ${expiringSoon.length > 0 ? 'border-amber-300 bg-amber-50' : 'bg-white border-slate-200'}`}>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">{t('kpi.expiring30')}</p>
            <p className={`text-xl font-bold ${expiringSoon.length > 0 ? 'text-amber-600' : 'text-slate-900'}`}>{expiringSoon.length}</p>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">{t('kpi.expiring60')}</p>
            <p className="text-xl font-bold text-slate-900">{expiringIn60.length}</p>
          </div>
        </div>
      )}

      {/* Expiring soon alert */}
      {expiringSoon.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-5 py-3">
          <p className="text-sm font-semibold text-amber-800 mb-1">{t('kpi.expiringAlert', { count: expiringSoon.length })}</p>
          <ul className="space-y-0.5">
            {expiringSoon.map((c) => {
              const tenant = c.tenants as { full_name: string } | null;
              return (
                <li key={c.id} className="text-xs text-amber-700">
                  {tenant?.full_name ?? '—'} — {t('kpi.endsOn')} {c.end_date}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {contracts.length === 0 ? (
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
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden sm:table-cell">{t('list.colUnit')}</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">{t('list.colRent')}</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden md:table-cell">{t('list.colTerm')}</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">{t('list.colStatus')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {contracts.map((contract) => {
                const tenant = contract.tenants as { full_name: string } | null;
                const unit = contract.units as { label: string; properties: { name: string } | null } | null;
                const isExpiringSoon = expiringSoon.some((c) => c.id === contract.id);
                return (
                  <tr key={contract.id} className={`transition-colors ${isExpiringSoon ? 'bg-amber-50 hover:bg-amber-100' : 'hover:bg-slate-50'}`}>
                    <td className="px-5 py-4 text-sm font-medium text-slate-900">{tenant?.full_name ?? '—'}</td>
                    <td className="px-5 py-4 text-sm text-slate-500 hidden sm:table-cell">
                      {unit ? `${unit.properties?.name ?? ''} — ${unit.label}` : '—'}
                    </td>
                    <td className="px-5 py-4 text-sm font-semibold text-slate-900">
                      S/ {contract.monthly_rent.toLocaleString('es-PE', { minimumFractionDigits: 2 })}/mo
                    </td>
                    <td className="px-5 py-4 text-xs hidden md:table-cell">
                      <span className={isExpiringSoon ? 'text-amber-700 font-medium' : 'text-slate-500'}>
                        {contract.start_date} → {contract.end_date ?? '—'}
                      </span>
                    </td>
                    <td className="px-5 py-4"><StatusPill status={contract.status} /></td>
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
