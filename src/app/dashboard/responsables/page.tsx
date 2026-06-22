import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { requireAdmin } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { responsables, tenants } from '@/lib/db/schema';
import { eq, asc, isNotNull } from 'drizzle-orm';
import { getTranslations } from 'next-intl/server';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';

export const metadata: Metadata = { title: 'Responsables' };

export default async function ResponsablesPage() {
  let ctx;
  try { ctx = await requireAdmin(); } catch { redirect('/login'); }

  const [rows, t] = await Promise.all([
    db
      .select({
        id:               responsables.id,
        fullName:         responsables.fullName,
        dni:              responsables.dni,
        phone:            responsables.phone,
        email:            responsables.email,
        employment:       responsables.employment,
        company:          responsables.company,
        jobTitle:         responsables.jobTitle,
        industry:         responsables.industry,
        photoUrl:         responsables.photoUrl,
        airtableSyncedAt: responsables.airtableSyncedAt,
      })
      .from(responsables)
      .where(eq(responsables.orgId, ctx.orgId))
      .orderBy(asc(responsables.fullName)),
    getTranslations('responsables'),
  ]);

  // Count tenants linked per responsable
  const links = await db
    .select({ responsableId: tenants.responsableId })
    .from(tenants)
    .where(eq(tenants.orgId, ctx.orgId));

  const tenantsByResponsable: Record<string, number> = {};
  for (const row of links) {
    if (row.responsableId) {
      tenantsByResponsable[row.responsableId] = (tenantsByResponsable[row.responsableId] ?? 0) + 1;
    }
  }

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">{t('title')}</h1>
        <p className="text-sm text-slate-500 mt-1">{t('subtitle', { count: rows.length })}</p>
      </div>

      {rows.length === 0 ? (
        <Card>
          <EmptyState title={t('emptyTitle')} description={t('emptyDesc')} />
        </Card>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full" aria-label={t('title')}>
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">{t('colName')}</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden sm:table-cell">{t('colContact')}</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden md:table-cell">{t('colEmployment')}</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden lg:table-cell">{t('colCompany')}</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">{t('colTenants')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => {
                const tenantCount = tenantsByResponsable[r.id] ?? 0;
                return (
                  <tr key={r.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-5 py-4">
                      <div>
                        <p className="text-sm font-medium text-slate-900">{r.fullName ?? '—'}</p>
                        {r.dni && <p className="text-xs text-slate-400">DNI: {r.dni}</p>}
                      </div>
                    </td>
                    <td className="px-5 py-4 hidden sm:table-cell">
                      <div className="space-y-0.5">
                        {r.phone && <p className="text-xs text-slate-600">{r.phone}</p>}
                        {r.email && <p className="text-xs text-brand-600">{r.email}</p>}
                      </div>
                    </td>
                    <td className="px-5 py-4 text-sm text-slate-500 capitalize hidden md:table-cell">
                      {r.employment ?? '—'}
                    </td>
                    <td className="px-5 py-4 hidden lg:table-cell">
                      <div>
                        <p className="text-sm text-slate-700">{r.company ?? '—'}</p>
                        {r.jobTitle && <p className="text-xs text-slate-400">{r.jobTitle}</p>}
                        {r.industry && <p className="text-xs text-slate-400">{r.industry}</p>}
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      {tenantCount > 0 ? (
                        <span className="inline-flex items-center justify-center min-w-[24px] h-6 px-2 rounded-full text-xs font-semibold bg-brand-100 text-brand-700">
                          {tenantCount}
                        </span>
                      ) : (
                        <span className="text-xs text-slate-300">{t('noTenants')}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-slate-400">{t('syncNote')}</p>
    </div>
  );
}
