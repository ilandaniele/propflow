import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { createAdminServerClient as createClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/auth/guards';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { StatusPill } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ClickableRow } from '@/components/ui/ClickableRow';
import { computeOccupancy } from '@/lib/finance/kpis';
import { CreateUnitForm } from './CreateUnitForm';

export const metadata: Metadata = { title: 'Units' };

function ToiletTypeBadge({ value, label }: { value: string | null | undefined; label: string }) {
  if (value === 'private' || value === 'shared') {
    return <span>{label}</span>;
  }
  return <span className="text-slate-400">{label || '—'}</span>;
}

export default async function UnitsPage() {
  let ctx;
  try { ctx = await requireAdmin(); } catch { redirect('/login'); }

  const [t, supabase] = await Promise.all([getTranslations('units'), createClient()]);

  const [unitsRes, propertiesRes] = await Promise.all([
    supabase.from('units').select('*, properties(name)').eq('org_id', ctx.orgId).order('created_at', { ascending: false }),
    supabase.from('properties').select('id, name').eq('org_id', ctx.orgId),
  ]);

  const units = unitsRes.data ?? [];
  const properties = propertiesRes.data ?? [];

  const totalUnits = units.length;
  const occupiedUnits = units.filter((u) => u.status === 'occupied').length;
  const vacantUnits = totalUnits - occupiedUnits;
  const maintenanceUnits = units.filter((u) => u.status === 'maintenance').length;
  const occupancyKpi = computeOccupancy(occupiedUnits, totalUnits);

  // Area analytics from Airtable-synced area_m2
  const withArea = units.filter((u) => u.area_m2 != null && Number(u.area_m2) > 0);
  const avgArea = withArea.length > 0
    ? (withArea.reduce((s, u) => s + Number(u.area_m2), 0) / withArea.length).toFixed(1)
    : null;

  // Status breakdown: all statuses present
  const statusCounts: Record<string, number> = {};
  for (const u of units) {
    const s = u.status ?? 'unknown';
    statusCounts[s] = (statusCounts[s] ?? 0) + 1;
  }

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{t('title')}</h1>
          <p className="text-sm text-slate-500 mt-1">{units.length} total</p>
        </div>
        <CreateUnitForm properties={properties} />
      </div>

      {totalUnits > 0 && (
        <>
          {/* Occupancy KPI tiles */}
          <div data-testid="occupancy-stats-tile" className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <article className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">{t('kpi.total')}</p>
              <p className="text-2xl font-bold text-slate-800">{totalUnits}</p>
            </article>
            <article className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">{t('kpi.occupied')}</p>
              <p className="text-2xl font-bold text-green-700">{occupiedUnits}</p>
              {maintenanceUnits > 0 && (
                <p className="text-xs text-amber-500 mt-0.5">{maintenanceUnits} {t('kpi.maintenance')}</p>
              )}
            </article>
            <article className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">{t('kpi.vacancy')}</p>
              <p className={`text-2xl font-bold ${vacantUnits > 0 ? 'text-amber-600' : 'text-slate-400'}`}>{vacantUnits}</p>
            </article>
            <article className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">{t('kpi.occupancyPct')}</p>
              <p className={`text-2xl font-bold ${occupancyKpi.value >= 0.8 ? 'text-green-700' : occupancyKpi.value >= 0.5 ? 'text-amber-600' : 'text-red-600'}`}>
                {occupancyKpi.formatted}
              </p>
            </article>
          </div>

          {/* Area + status breakdown */}
          {(avgArea !== null || Object.keys(statusCounts).length > 1) && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {avgArea !== null && (
                <div className="bg-white rounded-xl border border-slate-200 p-5">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">{t('kpi.area')}</p>
                  <p className="text-2xl font-bold text-slate-900">{avgArea} m²</p>
                  <p className="text-xs text-slate-400 mt-0.5">across {withArea.length} units</p>
                </div>
              )}
              {Object.keys(statusCounts).length > 1 && (
                <div className="bg-white rounded-xl border border-slate-200 p-5">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">{t('kpi.byStatus')}</p>
                  <div className="space-y-1.5">
                    {Object.entries(statusCounts).sort(([, a], [, b]) => b - a).map(([status, count]) => (
                      <div key={status} className="flex items-center gap-2">
                        <div className="flex-1 bg-slate-100 rounded-full h-2">
                          <div
                            className={`h-2 rounded-full ${status === 'occupied' ? 'bg-green-500' : status === 'maintenance' ? 'bg-amber-400' : 'bg-slate-300'}`}
                            style={{ width: `${Math.round((count / totalUnits) * 100)}%` }}
                          />
                        </div>
                        <span className="text-xs text-slate-600 capitalize w-24">{status}</span>
                        <span className="text-xs font-semibold text-slate-700 w-6 text-right">{count}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {units.length === 0 ? (
        <Card>
          <EmptyState title={t('list.emptyTitle')} description={t('list.emptyDesc')} />
        </Card>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full" aria-label={t('list.tableLabel')}>
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">{t('list.colUnit')}</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden sm:table-cell">{t('list.colProperty')}</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden md:table-cell">{t('list.colRent')}</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden lg:table-cell">{t('list.colBathroom')}</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">{t('list.colStatus')}</th>
                <th className="text-right px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">{t('list.colActions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {units.map((unit) => {
                const property = unit.properties as { name: string } | null;
                return (
                  <ClickableRow key={unit.id} href={`/dashboard/units/${unit.id}`}>
                    <td className="px-5 py-4">
                      <p className="font-medium text-slate-900 text-sm">{unit.label}</p>
                      <div className="flex gap-2">
                        {unit.floor && <p className="text-xs text-slate-400">{t('list.floor')} {unit.floor}</p>}
                        {unit.area_m2 && <p className="text-xs text-slate-400">{Number(unit.area_m2).toFixed(0)} m²</p>}
                      </div>
                    </td>
                    <td className="px-5 py-4 text-sm text-slate-500 hidden sm:table-cell">{property?.name ?? '—'}</td>
                    <td className="px-5 py-4 text-sm text-slate-500 hidden md:table-cell">
                      {unit.monthly_rent_default ? `S/ ${Number(unit.monthly_rent_default).toLocaleString('es-PE', { minimumFractionDigits: 2 })}` : '—'}
                    </td>
                    <td className="px-5 py-4 text-sm hidden lg:table-cell">
                      <ToiletTypeBadge
                        value={unit.toilet_type}
                        label={
                          unit.toilet_type === 'private' ? t('toiletType.private')
                          : unit.toilet_type === 'shared' ? t('toiletType.shared')
                          : t('toiletType.none')
                        }
                      />
                    </td>
                    <td className="px-5 py-4"><StatusPill status={unit.status} /></td>
                    <td className="px-5 py-4 text-right">
                      <Link href={`/dashboard/units/${unit.id}`}>
                        <Button variant="ghost" size="sm">{t('list.view')}</Button>
                      </Link>
                    </td>
                  </ClickableRow>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
