import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createAdminServerClient as createClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/auth/guards';
import { getTranslations } from 'next-intl/server';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { StatusPill, PriorityPill } from '@/components/ui/Badge';
import { PriorityLegend } from '@/components/incidents/PriorityLegend';

export const metadata: Metadata = { title: 'Incidents' };

export default async function IncidentsPage() {
  let ctx;
  try { ctx = await requireAdmin(); } catch { redirect('/login'); }

  const [supabase, t] = await Promise.all([createClient(), getTranslations('incidents')]);

  const { data: incidents } = await supabase
    .from('incidents')
    .select('*, profiles!incidents_created_by_fkey(full_name), tenants(full_name)')
    .eq('org_id', ctx.orgId)
    .order('created_at', { ascending: false })
    .limit(200);

  const list = incidents ?? [];

  // Cost analytics
  const withCost = list.filter((i) => i.cost != null && Number(i.cost) > 0);
  const totalCost = withCost.reduce((s, i) => s + Number(i.cost), 0);
  const costByCategory: Record<string, number> = {};
  for (const i of withCost) {
    costByCategory[i.category] = (costByCategory[i.category] ?? 0) + Number(i.cost);
  }
  const openCount = list.filter((i) => i.status !== 'solved').length;
  const solvedCount = list.filter((i) => i.status === 'solved').length;

  // Monthly cost trend (last 6 months)
  const incNow = new Date();
  const incLast6: string[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(incNow.getFullYear(), incNow.getMonth() - i, 1);
    incLast6.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  const costByMonth: Record<string, number> = {};
  for (const inc of withCost) {
    const key = String(inc.created_at).slice(0, 7);
    costByMonth[key] = (costByMonth[key] ?? 0) + Number(inc.cost);
  }
  const maxCostMonth = Math.max(1, ...incLast6.map((k) => costByMonth[k] ?? 0));

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{t('title')}</h1>
          <p className="text-sm text-slate-500 mt-1">{list.length} total · {openCount} {t('list.open')} · {solvedCount} {t('list.solved')}</p>
        </div>
      </div>

      {/* Cost KPI tiles */}
      {withCost.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">{t('kpi.totalCost')}</p>
            <p className="text-xl font-bold text-slate-900">S/ {totalCost.toLocaleString('es-PE', { minimumFractionDigits: 2 })}</p>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">{t('kpi.avgCost')}</p>
            <p className="text-xl font-bold text-slate-900">S/ {(totalCost / withCost.length).toLocaleString('es-PE', { minimumFractionDigits: 2 })}</p>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">{t('kpi.openRate')}</p>
            <p className="text-xl font-bold text-slate-900">{list.length > 0 ? Math.round((openCount / list.length) * 100) : 0}%</p>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">{t('kpi.withCost')}</p>
            <p className="text-xl font-bold text-slate-900">{withCost.length}</p>
          </div>
        </div>
      )}

      {/* Cost by category */}
      {Object.keys(costByCategory).length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <h2 className="text-sm font-semibold text-slate-700 mb-3">{t('kpi.costByCategory')}</h2>
          <div className="space-y-2">
            {Object.entries(costByCategory)
              .sort(([, a], [, b]) => b - a)
              .map(([cat, cost]) => {
                const pct = totalCost > 0 ? Math.round((cost / totalCost) * 100) : 0;
                return (
                  <div key={cat} className="flex items-center gap-3">
                    <span className="text-xs text-slate-500 capitalize w-24 shrink-0">{cat}</span>
                    <div className="flex-1 bg-slate-100 rounded-full h-2">
                      <div className="bg-brand-500 h-2 rounded-full" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="text-xs font-semibold text-slate-700 w-28 text-right">
                      S/ {cost.toLocaleString('es-PE', { minimumFractionDigits: 2 })} ({pct}%)
                    </span>
                  </div>
                );
              })}
          </div>
        </div>
      )}

      {/* Monthly cost trend */}
      {incLast6.some((k) => costByMonth[k] > 0) && (
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <h2 className="text-sm font-semibold text-slate-700 mb-3">{t('kpi.costTrend')}</h2>
          <div className="flex items-end gap-1 h-20">
            {incLast6.map((k) => {
              const amount = costByMonth[k] ?? 0;
              const heightPct = Math.round((amount / maxCostMonth) * 100);
              return (
                <div key={k} className="flex-1 flex flex-col items-center gap-1">
                  <div className="w-full flex items-end justify-center" style={{ height: '48px' }}>
                    <div
                      title={`${k}: S/ ${amount.toLocaleString('es-PE', { minimumFractionDigits: 2 })}`}
                      style={{ height: `${heightPct}%`, minHeight: amount > 0 ? '4px' : '0' }}
                      className="w-full rounded-t-sm bg-amber-400"
                    />
                  </div>
                  <p className="text-xs text-slate-400">{k.slice(5)}</p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <PriorityLegend />

      {list.length === 0 ? (
        <Card>
          <EmptyState
            title={t('list.emptyTitle')}
            description={t('list.emptyDesc')}
          />
        </Card>
      ) : (
        <div className="space-y-2">
          {list.map((incident) => {
            const createdBy = incident.profiles as { full_name: string | null } | null;
            return (
              <Link key={incident.id} href={`/dashboard/incidents/${incident.id}`} className="block">
                <div className="bg-white rounded-xl border border-slate-200 px-5 py-4 hover:border-brand-300 hover:shadow-md transition-all duration-150 flex items-center justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <PriorityPill priority={incident.priority} />
                      <span className="text-xs text-slate-400 capitalize">{incident.category}</span>
                      {incident.cost != null && Number(incident.cost) > 0 && (
                        <span className="text-xs font-semibold text-amber-600">
                          S/ {Number(incident.cost).toLocaleString('es-PE', { minimumFractionDigits: 2 })}
                        </span>
                      )}
                    </div>
                    <p className="font-medium text-slate-900 text-sm truncate">{incident.title}</p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {createdBy?.full_name ?? t('list.unknown')} · {new Date(incident.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  <StatusPill status={incident.status} />
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
