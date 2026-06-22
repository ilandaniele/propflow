import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAdmin } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { tenants, units, properties } from '@/lib/db/schema';
import { eq, desc, and } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
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

  const t = await getTranslations('tenants');

  const [list, statements] = await Promise.all([
    db
      .select({
        id:          tenants.id,
        fullName:    tenants.fullName,
        email:       tenants.email,
        phone:       tenants.phone,
        photoUrl:    tenants.photoUrl,
        unitId:      tenants.unitId,
        profileId:   tenants.profileId,
        documentNumber: tenants.documentNumber,
        createdAt:   tenants.createdAt,
        unitLabel:   units.label,
        propertyName: properties.name,
      })
      .from(tenants)
      .leftJoin(units, and(eq(units.id, tenants.unitId), eq(units.orgId, ctx.orgId)))
      .leftJoin(properties, and(eq(properties.id, units.propertyId), eq(properties.orgId, ctx.orgId)))
      .where(eq(tenants.orgId, ctx.orgId))
      .orderBy(desc(tenants.createdAt)),
    // tenant_statement is a PG VIEW — use raw SQL
    db.execute(sql`SELECT tenant_id, total_charged, total_paid, is_overdue, org_id FROM tenant_statement WHERE org_id = ${ctx.orgId}`),
  ]);

  const stmtRows = (statements as unknown as Array<{ tenant_id: string; total_charged: string; total_paid: string; is_overdue: boolean }>);

  const overdueAmounts: number[] = stmtRows
    .filter((s) => s.is_overdue)
    .map((s) => Math.max(0, Number(s.total_charged ?? 0) - Number(s.total_paid ?? 0)));
  const pastDueKpi  = computePastDueBalance(overdueAmounts);

  const linkedCount  = list.filter((tn) => tn.profileId).length;
  const overdueCount = stmtRows.filter((s) => s.is_overdue).length;

  // Tenure analysis
  const tenantNow    = new Date();
  const tenureBuckets = { lt3m: 0, bt3_12m: 0, bt1_2y: 0, gt2y: 0 };
  for (const tn of list) {
    const created = tn.createdAt ? new Date(tn.createdAt) : null;
    if (!created) continue;
    const months = (tenantNow.getFullYear() - created.getFullYear()) * 12 + (tenantNow.getMonth() - created.getMonth());
    if (months < 3) tenureBuckets.lt3m++;
    else if (months < 12) tenureBuckets.bt3_12m++;
    else if (months < 24) tenureBuckets.bt1_2y++;
    else tenureBuckets.gt2y++;
  }

  // Field coverage
  const withEmail = list.filter((tn) => tn.email).length;
  const withPhone = list.filter((tn) => tn.phone).length;
  const withDni   = list.filter((tn) => tn.documentNumber).length;
  const withPhoto = list.filter((tn) => tn.photoUrl).length;
  const withUnit  = list.filter((tn) => tn.unitId).length;

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
          <article data-testid="kpi-past-due-balance" className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">{t('list.kpiPastDue')}</p>
            <p className={`text-2xl font-bold mb-1 ${pastDueKpi.value > 0 ? 'text-red-600' : 'text-green-700'}`}>
              {pastDueKpi.formatted}
            </p>
            <p className="text-xs text-slate-400">{t('list.kpiPastDueSub')}</p>
          </article>

          <article className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">{t('list.kpiOverdue')}</p>
            <p className={`text-2xl font-bold mb-1 ${overdueCount > 0 ? 'text-red-600' : 'text-green-700'}`}>
              {overdueCount}
            </p>
            <p className="text-xs text-slate-400">{t('list.kpiOverdueSub', { total: list.length })}</p>
          </article>

          <article className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">{t('list.kpiPortal')}</p>
            <p className="text-2xl font-bold mb-1 text-brand-700">{linkedCount}</p>
            <p className="text-xs text-slate-400">{t('list.kpiPortalSub', { total: list.length })}</p>
          </article>
        </div>
      )}

      {/* Tenure distribution */}
      {list.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">{t('kpi.tenure')}</h2>
          <div className="grid grid-cols-4 gap-3 text-center">
            {([
              { key: 'lt3m',    label: t('kpi.lt3m'),    value: tenureBuckets.lt3m,    color: 'text-slate-600' },
              { key: 'bt3_12m', label: t('kpi.bt3_12m'), value: tenureBuckets.bt3_12m, color: 'text-brand-600' },
              { key: 'bt1_2y',  label: t('kpi.bt1_2y'),  value: tenureBuckets.bt1_2y,  color: 'text-green-600' },
              { key: 'gt2y',    label: t('kpi.gt2y'),    value: tenureBuckets.gt2y,    color: 'text-green-700' },
            ]).map(({ key, label, value, color }) => (
              <div key={key}>
                <p className={`text-xl font-bold ${color}`}>{value}</p>
                <p className="text-xs text-slate-500 mt-0.5">{label}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Airtable field coverage */}
      {list.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">{t('kpi.demographics')}</h2>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
            {[
              { label: t('list.colEmail'), count: withEmail },
              { label: t('kpi.phone'),     count: withPhone },
              { label: t('kpi.dni'),       count: withDni },
              { label: t('kpi.photo'),     count: withPhoto },
              { label: t('list.colUnit'),  count: withUnit },
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
              {list.map((tenant) => (
                <ClickableRow key={tenant.id} href={`/dashboard/tenants/${tenant.id}`}>
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-3">
                      <Avatar name={tenant.fullName} size="sm" />
                      <span className="font-medium text-slate-900 text-sm">{tenant.fullName}</span>
                    </div>
                  </td>
                  <td className="px-5 py-4 text-sm text-slate-500 hidden sm:table-cell">
                    {tenant.email ?? <span className="text-slate-300">—</span>}
                  </td>
                  <td className="px-5 py-4 text-sm text-slate-500 hidden md:table-cell">
                    {tenant.unitLabel ? `${tenant.propertyName ?? ''} — ${tenant.unitLabel}` : <span className="text-slate-300">{t('list.unassigned')}</span>}
                  </td>
                  <td className="px-5 py-4 hidden md:table-cell">
                    <Badge variant={tenant.profileId ? 'success' : 'default'}>
                      {tenant.profileId ? t('list.portalActive') : t('list.portalNone')}
                    </Badge>
                  </td>
                  <td className="px-5 py-4 text-right">
                    <Link href={`/dashboard/tenants/${tenant.id}`}>
                      <Button variant="ghost" size="sm">{t('list.viewButton')}</Button>
                    </Link>
                  </td>
                </ClickableRow>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
