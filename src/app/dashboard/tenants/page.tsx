import type { Metadata } from 'next';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/auth/guards';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { Avatar } from '@/components/ui/Avatar';
import { ClickableRow } from '@/components/ui/ClickableRow';
import { computePastDueBalance } from '@/lib/finance/kpis';
import { CreateTenantForm } from './CreateTenantForm';
import { TenantsCsvButtons } from './TenantsCsvButtons';

export const metadata: Metadata = { title: 'Tenants' };

export default async function TenantsPage() {
  let ctx;
  try { ctx = await requireAdmin(); } catch { redirect('/login'); }

  const supabase = await createClient();
  const t = await getTranslations('tenants');

  const [tenantsRes, statementsRes] = await Promise.all([
    supabase
      .from('tenants')
      .select('*, units(label, properties(name))')
      .eq('org_id', ctx.orgId)
      .order('created_at', { ascending: false }),
    supabase.from('tenant_statement').select('*').eq('org_id', ctx.orgId),
  ]);

  const list = tenantsRes.data ?? [];
  const statements = statementsRes.data ?? [];

  const overdueAmounts: number[] = statements
    .filter((s) => s.is_overdue)
    .map((s) => Math.max(0, Number(s.total_charged ?? 0) - Number(s.total_paid ?? 0)));
  const pastDueKpi = computePastDueBalance(overdueAmounts);

  const linkedCount = list.filter((t) => t.profile_id).length;
  const overdueCount = statements.filter((s) => s.is_overdue).length;

  // Airtable-synced field coverage
  const withEmail  = list.filter((tn) => tn.email).length;
  const withPhone  = list.filter((tn) => tn.phone).length;
  const withDni    = list.filter((tn) => tn.dni).length;
  const withPhoto  = list.filter((tn) => tn.photo_url).length;
  const withUnit   = list.filter((tn) => tn.unit_id).length;

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{t('title')}</h1>
          <p className="text-sm text-slate-500 mt-1">{list.length} total</p>
        </div>
        <div className="flex items-center gap-2">
          <TenantsCsvButtons />
          <CreateTenantForm />
        </div>
      </div>

      {list.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <article
            data-testid="kpi-past-due-balance"
            className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm"
          >
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
              {t('list.kpiPastDue')}
            </p>
            <p className={`text-2xl font-bold mb-1 ${pastDueKpi.value > 0 ? 'text-red-600' : 'text-green-700'}`}>
              {pastDueKpi.formatted}
            </p>
            <p className="text-xs text-slate-400">{t('list.kpiPastDueSub')}</p>
          </article>

          <article className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
              {t('list.kpiOverdue')}
            </p>
            <p className={`text-2xl font-bold mb-1 ${overdueCount > 0 ? 'text-red-600' : 'text-green-700'}`}>
              {overdueCount}
            </p>
            <p className="text-xs text-slate-400">{t('list.kpiOverdueSub', { total: list.length })}</p>
          </article>

          <article className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
              {t('list.kpiPortal')}
            </p>
            <p className="text-2xl font-bold mb-1 text-brand-700">{linkedCount}</p>
            <p className="text-xs text-slate-400">{t('list.kpiPortalSub', { total: list.length })}</p>
          </article>
        </div>
      )}

      {/* Airtable field coverage row */}
      {list.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">{t('kpi.demographics')}</h2>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
            {[
              { label: t('list.colEmail'), count: withEmail },
              { label: t('kpi.phone'), count: withPhone },
              { label: t('kpi.dni'), count: withDni },
              { label: t('kpi.photo'), count: withPhoto },
              { label: t('list.colUnit'), count: withUnit },
            ].map(({ label, count }) => {
              const pct = list.length > 0 ? Math.round((count / list.length) * 100) : 0;
              return (
                <div key={label}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-slate-500">{label}</span>
                    <span className="font-semibold text-slate-700">{pct}%</span>
                  </div>
                  <div className="bg-slate-100 rounded-full h-1.5">
                    <div className={`h-1.5 rounded-full ${pct >= 80 ? 'bg-green-500' : pct >= 50 ? 'bg-amber-400' : 'bg-red-400'}`} style={{ width: `${pct}%` }} />
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5">{count}/{list.length}</p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {list.length === 0 ? (
        <Card>
          <EmptyState
            icon={
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
              </svg>
            }
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
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden sm:table-cell">{t('list.colEmail')}</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden md:table-cell">{t('list.colUnit')}</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden md:table-cell">{t('list.colPortal')}</th>
                <th className="text-right px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">{t('list.colActions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {list.map((tenant) => {
                const unit = tenant.units as { label: string; properties: { name: string } | null } | null;
                return (
                  <ClickableRow key={tenant.id} href={`/dashboard/tenants/${tenant.id}`}>
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-3">
                        <Avatar name={tenant.full_name} size="sm" />
                        <span className="font-medium text-slate-900 text-sm">{tenant.full_name}</span>
                      </div>
                    </td>
                    <td className="px-5 py-4 text-sm text-slate-500 hidden sm:table-cell">
                      {tenant.email ?? <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-5 py-4 text-sm text-slate-500 hidden md:table-cell">
                      {unit ? `${unit.properties?.name ?? ''} — ${unit.label}` : <span className="text-slate-300">{t('list.unassigned')}</span>}
                    </td>
                    <td className="px-5 py-4 hidden md:table-cell">
                      <Badge variant={tenant.profile_id ? 'success' : 'default'}>
                        {tenant.profile_id ? t('list.portalActive') : t('list.portalNone')}
                      </Badge>
                    </td>
                    <td className="px-5 py-4 text-right">
                      <Link href={`/dashboard/tenants/${tenant.id}`}>
                        <Button variant="ghost" size="sm">{t('list.viewButton')}</Button>
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
