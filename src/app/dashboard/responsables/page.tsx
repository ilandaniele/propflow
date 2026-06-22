import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { createAdminServerClient as createClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/auth/guards';
import { getTranslations } from 'next-intl/server';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';

export const metadata: Metadata = { title: 'Responsables' };

export default async function ResponsablesPage() {
  let ctx;
  try { ctx = await requireAdmin(); } catch { redirect('/login'); }

  const [supabase, t] = await Promise.all([createClient(), getTranslations('responsables')]);

  const { data: rows } = await supabase
    .from('responsables')
    .select('id, full_name, dni, phone, email, employment, company, job_title, industry, photo_dni_url, airtable_synced_at')
    .eq('org_id', ctx.orgId)
    .order('full_name');

  const responsables = rows ?? [];

  // Count tenants linked per responsable
  const { data: links } = await supabase
    .from('tenants')
    .select('responsable_id')
    .eq('org_id', ctx.orgId)
    .not('responsable_id', 'is', null);

  const tenantsByResponsable: Record<string, number> = {};
  for (const row of links ?? []) {
    if (row.responsable_id) {
      tenantsByResponsable[row.responsable_id] = (tenantsByResponsable[row.responsable_id] ?? 0) + 1;
    }
  }

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">{t('title')}</h1>
        <p className="text-sm text-slate-500 mt-1">{t('subtitle', { count: responsables.length })}</p>
      </div>

      {responsables.length === 0 ? (
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
              {responsables.map((r) => {
                const tenantCount = tenantsByResponsable[r.id] ?? 0;
                return (
                  <tr key={r.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-5 py-4">
                      <div>
                        <p className="text-sm font-medium text-slate-900">{r.full_name ?? '—'}</p>
                        {r.dni && (
                          <p className="text-xs text-slate-400">DNI: {r.dni}</p>
                        )}
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
                        {r.job_title && <p className="text-xs text-slate-400">{r.job_title}</p>}
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

      <p className="text-xs text-slate-400">
        {t('syncNote')}
      </p>
    </div>
  );
}
