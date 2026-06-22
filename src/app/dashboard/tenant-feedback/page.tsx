import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { requireAdmin } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { tenantFeedback, tenants } from '@/lib/db/schema';
import { eq, desc, and } from 'drizzle-orm';
import { getTranslations } from 'next-intl/server';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';

export const metadata: Metadata = { title: 'Tenant Feedback' };

function StarScore({ score }: { score: number | null }) {
  if (score === null) return <span className="text-slate-300">—</span>;
  const color = score >= 4 ? 'text-green-600' : score === 3 ? 'text-amber-500' : 'text-red-500';
  return (
    <span className={`font-semibold ${color}`}>
      {'★'.repeat(score)}{'☆'.repeat(5 - score)}
      <span className="ml-1 text-xs text-slate-400">{score}/5</span>
    </span>
  );
}

export default async function TenantFeedbackPage() {
  let ctx;
  try { ctx = await requireAdmin(); } catch { redirect('/login'); }

  const t = await getTranslations('tenantFeedback');

  const rows = await db
    .select({
      id:               tenantFeedback.id,
      fecha:            tenantFeedback.fecha,
      cleaningScore:    tenantFeedback.cleaningScore,
      coexistenceScore: tenantFeedback.coexistenceScore,
      attentionScore:   tenantFeedback.attentionScore,
      securityScore:    tenantFeedback.securityScore,
      valueScore:       tenantFeedback.valueScore,
      wouldRecommend:   tenantFeedback.wouldRecommend,
      comment:          tenantFeedback.comment,
      worstExperience:  tenantFeedback.worstExperience,
      tenantFullName:   tenants.fullName,
    })
    .from(tenantFeedback)
    .leftJoin(tenants, and(eq(tenants.id, tenantFeedback.tenantId), eq(tenants.orgId, ctx.orgId)))
    .where(eq(tenantFeedback.orgId, ctx.orgId))
    .orderBy(desc(tenantFeedback.fecha))
    .limit(100);

  const avgScore = (getter: (r: typeof rows[number]) => number | null) => {
    const vals = rows.map(getter).filter((v): v is number => v !== null);
    if (!vals.length) return null;
    return (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1);
  };

  const metrics = [
    { label: t('metricCleaning'),    getter: (r: typeof rows[number]) => r.cleaningScore },
    { label: t('metricCoexistence'), getter: (r: typeof rows[number]) => r.coexistenceScore },
    { label: t('metricAttention'),   getter: (r: typeof rows[number]) => r.attentionScore },
    { label: t('metricSecurity'),    getter: (r: typeof rows[number]) => r.securityScore },
    { label: t('metricValue'),       getter: (r: typeof rows[number]) => r.valueScore },
  ];

  const recommendCount = rows.filter((r) => r.wouldRecommend === true).length;
  const recommendRate  = rows.length > 0 ? Math.round((recommendCount / rows.length) * 100) : 0;

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">{t('title')}</h1>
        <p className="text-sm text-slate-500 mt-1">{t('subtitle', { count: rows.length })}</p>
      </div>

      {rows.length > 0 && (
        <>
          {/* Average score tiles */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {metrics.map(({ label, getter }) => {
              const avg = avgScore(getter);
              const numAvg = avg !== null ? parseFloat(avg) : null;
              const color = numAvg !== null ? (numAvg >= 4 ? 'text-green-600' : numAvg >= 3 ? 'text-amber-500' : 'text-red-500') : 'text-slate-900';
              return (
                <div key={label} className="bg-white rounded-xl border border-slate-200 p-4 text-center">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">{label}</p>
                  <p className={`text-2xl font-bold ${color}`}>{avg ?? '—'}</p>
                  <p className="text-xs text-slate-400">{t('avgLabel')}</p>
                </div>
              );
            })}
          </div>

          {/* Recommend rate */}
          <div className="bg-white rounded-xl border border-slate-200 p-5 flex items-center gap-6">
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">{t('colRecommend')}</p>
              <p className="text-3xl font-bold text-green-600 mt-1">{recommendRate}%</p>
            </div>
            <div className="flex-1 bg-slate-100 rounded-full h-3">
              <div className="bg-green-500 h-3 rounded-full transition-all" style={{ width: `${recommendRate}%` }} />
            </div>
            <p className="text-sm text-slate-500">{recommendCount}/{rows.length}</p>
          </div>
        </>
      )}

      {rows.length === 0 ? (
        <Card>
          <EmptyState title={t('emptyTitle')} description={t('emptyDesc')} />
        </Card>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full" aria-label={t('title')}>
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">{t('colTenant')}</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden sm:table-cell">{t('colDate')}</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">{t('colCleaning')}</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden md:table-cell">{t('colAttention')}</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden md:table-cell">{t('colSecurity')}</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden lg:table-cell">{t('colValue')}</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden lg:table-cell">{t('colRecommend')}</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden xl:table-cell">{t('colWorst')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((fb) => (
                <tr key={fb.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-5 py-4 text-sm font-medium text-slate-900">{fb.tenantFullName ?? '—'}</td>
                  <td className="px-5 py-4 text-sm text-slate-500 hidden sm:table-cell">{fb.fecha ?? '—'}</td>
                  <td className="px-5 py-4 text-sm"><StarScore score={fb.cleaningScore} /></td>
                  <td className="px-5 py-4 text-sm hidden md:table-cell"><StarScore score={fb.attentionScore} /></td>
                  <td className="px-5 py-4 text-sm hidden md:table-cell"><StarScore score={fb.securityScore} /></td>
                  <td className="px-5 py-4 text-sm hidden lg:table-cell"><StarScore score={fb.valueScore} /></td>
                  <td className="px-5 py-4 text-sm hidden lg:table-cell">
                    {fb.wouldRecommend === true ? (
                      <span className="text-green-600 font-medium">{t('yes')}</span>
                    ) : fb.wouldRecommend === false ? (
                      <span className="text-red-500 font-medium">{t('no')}</span>
                    ) : '—'}
                  </td>
                  <td className="px-5 py-4 text-sm text-slate-500 hidden xl:table-cell max-w-xs truncate">
                    {fb.worstExperience ?? fb.comment ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
