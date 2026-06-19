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

  const supabase = await createClient();
  const t = await getTranslations('contracts');

  const [contractsRes, tenantsRes, unitsRes] = await Promise.all([
    supabase.from('contracts').select('*, tenants(full_name), units(label, properties(name))').eq('org_id', ctx.orgId).order('created_at', { ascending: false }),
    supabase.from('tenants').select('id, full_name').eq('org_id', ctx.orgId),
    supabase.from('units').select('id, label, property_id, properties(name)').eq('org_id', ctx.orgId),
  ]);

  const contracts = contractsRes.data ?? [];
  const tenants = tenantsRes.data ?? [];
  const units = unitsRes.data ?? [];

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{t('title')}</h1>
          <p className="text-sm text-slate-500 mt-1">{contracts.length} total</p>
        </div>
        <CreateContractForm tenants={tenants} units={units as unknown as Array<{ id: string; label: string; property_id: string; properties: { name: string } | null }>} />
      </div>

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
                return (
                  <tr key={contract.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-5 py-4 text-sm font-medium text-slate-900">{tenant?.full_name ?? '—'}</td>
                    <td className="px-5 py-4 text-sm text-slate-500 hidden sm:table-cell">
                      {unit ? `${unit.properties?.name ?? ''} — ${unit.label}` : '—'}
                    </td>
                    <td className="px-5 py-4 text-sm font-semibold text-slate-900">
                      S/ {contract.monthly_rent.toLocaleString('es-PE', { minimumFractionDigits: 2 })}/mo
                    </td>
                    <td className="px-5 py-4 text-xs text-slate-500 hidden md:table-cell">
                      {contract.start_date} → {contract.end_date ?? '—'}
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
