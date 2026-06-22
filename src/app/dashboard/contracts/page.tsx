import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { requireAdmin } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { contracts, tenants, units, properties } from '@/lib/db/schema';
import { eq, desc, and } from 'drizzle-orm';
import { getTranslations } from 'next-intl/server';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { StatusPill } from '@/components/ui/Badge';
import { CreateContractForm } from './CreateContractForm';

export const metadata: Metadata = { title: 'Contracts' };

export default async function ContractsPage() {
  let ctx;
  try { ctx = await requireAdmin(); } catch { redirect('/login'); }

  const t = await getTranslations('contracts');

  const [contractRows, tenantRows, unitRows] = await Promise.all([
    db
      .select({
        id:           contracts.id,
        status:       contracts.status,
        monthlyRent:  contracts.monthlyRent,
        startDate:    contracts.startDate,
        endDate:      contracts.endDate,
        tenantId:     contracts.tenantId,
        unitId:       contracts.unitId,
        createdAt:    contracts.createdAt,
        tenantName:   tenants.fullName,
        unitLabel:    units.label,
        propertyName: properties.name,
      })
      .from(contracts)
      .leftJoin(tenants, and(eq(tenants.id, contracts.tenantId), eq(tenants.orgId, ctx.orgId)))
      .leftJoin(units, and(eq(units.id, contracts.unitId), eq(units.orgId, ctx.orgId)))
      .leftJoin(properties, and(eq(properties.id, units.propertyId), eq(properties.orgId, ctx.orgId)))
      .where(eq(contracts.orgId, ctx.orgId))
      .orderBy(desc(contracts.createdAt)),
    db
      .select({ id: tenants.id, fullName: tenants.fullName })
      .from(tenants)
      .where(eq(tenants.orgId, ctx.orgId)),
    db
      .select({ id: units.id, label: units.label, propertyId: units.propertyId, propertyName: properties.name })
      .from(units)
      .leftJoin(properties, and(eq(properties.id, units.propertyId), eq(properties.orgId, ctx.orgId)))
      .where(eq(units.orgId, ctx.orgId)),
  ]);

  // Analytics
  const now = new Date();
  const in30Days = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const in60Days = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const today    = now.toISOString().slice(0, 10);

  const active        = contractRows.filter((c) => c.status === 'active');
  const expiringSoon  = active.filter((c) => c.endDate && c.endDate >= today && c.endDate <= in30Days);
  const expiringIn60  = active.filter((c) => c.endDate && c.endDate > in30Days && c.endDate <= in60Days);
  const totalMonthlyRent = active.reduce((s, c) => s + Number(c.monthlyRent), 0);

  const rentBuckets: Record<string, number> = { '<500': 0, '500-1k': 0, '1k-2k': 0, '2k-5k': 0, '>5k': 0 };
  for (const c of active) {
    const r = Number(c.monthlyRent);
    if (r < 500) rentBuckets['<500']++;
    else if (r < 1000) rentBuckets['500-1k']++;
    else if (r < 2000) rentBuckets['1k-2k']++;
    else if (r < 5000) rentBuckets['2k-5k']++;
    else rentBuckets['>5k']++;
  }
  const maxBucket = Math.max(1, ...Object.values(rentBuckets));

  const contractsLast6: string[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    contractsLast6.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  const startedByMonth: Record<string, number> = {};
  for (const c of contractRows) {
    if (!c.startDate) continue;
    const key = String(c.startDate).slice(0, 7);
    startedByMonth[key] = (startedByMonth[key] ?? 0) + 1;
  }
  const maxStarted = Math.max(1, ...contractsLast6.map((k) => startedByMonth[k] ?? 0));

  // Shape for CreateContractForm (legacy prop shape)
  const tenantsForForm = tenantRows.map((t) => ({ id: t.id, full_name: t.fullName }));
  const unitsForForm = unitRows.map((u) => ({ id: u.id, label: u.label, property_id: u.propertyId, properties: u.propertyName ? { name: u.propertyName } : null }));

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{t('title')}</h1>
          <p className="text-sm text-slate-500 mt-1">{contractRows.length} total · {active.length} {t('kpi.active')}</p>
        </div>
        <CreateContractForm tenants={tenantsForForm} units={unitsForForm as unknown as Array<{ id: string; label: string; property_id: string; properties: { name: string } | null }>} />
      </div>

      {/* KPI tiles */}
      {contractRows.length > 0 && (
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

      {/* Rent distribution + started trend */}
      {active.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-white rounded-xl border border-slate-200 p-5">
            <h2 className="text-sm font-semibold text-slate-700 mb-3">{t('kpi.rentDistribution')}</h2>
            <div className="space-y-1.5">
              {Object.entries(rentBuckets).filter(([, count]) => count > 0).map(([label, count]) => (
                <div key={label} className="flex items-center gap-2">
                  <span className="text-xs text-slate-500 w-16 shrink-0">S/ {label}</span>
                  <div className="flex-1 bg-slate-100 rounded-full h-2">
                    <div className="bg-brand-500 h-2 rounded-full" style={{ width: `${Math.round((count / maxBucket) * 100)}%` }} />
                  </div>
                  <span className="text-xs font-semibold text-slate-700 w-4 text-right">{count}</span>
                </div>
              ))}
            </div>
          </div>
          {contractsLast6.some((k) => startedByMonth[k] > 0) && (
            <div className="bg-white rounded-xl border border-slate-200 p-5">
              <h2 className="text-sm font-semibold text-slate-700 mb-3">{t('kpi.newContracts')}</h2>
              <div className="flex items-end gap-1 h-20">
                {contractsLast6.map((k) => {
                  const count = startedByMonth[k] ?? 0;
                  const heightPct = Math.round((count / maxStarted) * 100);
                  return (
                    <div key={k} className="flex-1 flex flex-col items-center gap-1">
                      <div className="w-full flex items-end justify-center" style={{ height: '48px' }}>
                        <div
                          title={`${k}: ${count}`}
                          style={{ height: `${heightPct}%`, minHeight: count > 0 ? '4px' : '0' }}
                          className="w-full rounded-t-sm bg-brand-400"
                        />
                      </div>
                      <p className="text-xs text-slate-400">{k.slice(5)}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Expiring soon alert */}
      {expiringSoon.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-5 py-3">
          <p className="text-sm font-semibold text-amber-800 mb-1">{t('kpi.expiringAlert', { count: expiringSoon.length })}</p>
          <ul className="space-y-0.5">
            {expiringSoon.map((c) => (
              <li key={c.id} className="text-xs text-amber-700">
                {c.tenantName ?? '—'} — {t('kpi.endsOn')} {c.endDate}
              </li>
            ))}
          </ul>
        </div>
      )}

      {contractRows.length === 0 ? (
        <Card>
          <EmptyState title={t('list.emptyTitle')} description={t('list.emptyDesc')} />
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
              {contractRows.map((contract) => {
                const isExpiringSoon = expiringSoon.some((c) => c.id === contract.id);
                return (
                  <tr key={contract.id} className={`transition-colors ${isExpiringSoon ? 'bg-amber-50 hover:bg-amber-100' : 'hover:bg-slate-50'}`}>
                    <td className="px-5 py-4 text-sm font-medium text-slate-900">{contract.tenantName ?? '—'}</td>
                    <td className="px-5 py-4 text-sm text-slate-500 hidden sm:table-cell">
                      {contract.propertyName || contract.unitLabel ? `${contract.propertyName ?? ''} — ${contract.unitLabel ?? ''}` : '—'}
                    </td>
                    <td className="px-5 py-4 text-sm font-semibold text-slate-900">
                      {contract.monthlyRent != null ? `S/ ${Number(contract.monthlyRent).toLocaleString('es-PE', { minimumFractionDigits: 2 })}/mo` : '—'}
                    </td>
                    <td className="px-5 py-4 text-xs hidden md:table-cell">
                      <span className={isExpiringSoon ? 'text-amber-700 font-medium' : 'text-slate-500'}>
                        {contract.startDate} → {contract.endDate ?? '—'}
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
