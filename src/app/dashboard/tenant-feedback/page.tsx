import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/auth/guards';
import { getTranslations } from 'next-intl/server';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';

export const metadata: Metadata = { title: 'Tenant Feedback' };

function StarScore({ score }: { score: number | null }) {
  if (score === null) return <span className="text-slate-300">—</span>;
  return (
    <span className="font-semibold text-slate-700">
      {'★'.repeat(score)}{'☆'.repeat(5 - score)}
      <span className="ml-1 text-xs text-slate-400">{score}/5</span>
    </span>
  );
}

export default async function TenantFeedbackPage() {
  let ctx;
  try { ctx = await requireAdmin(); } catch { redirect('/login'); }

  const supabase = await createClient();
  const { data: feedback } = await supabase
    .from('tenant_feedback')
    .select('*, tenants(full_name)')
    .eq('org_id', ctx.orgId)
    .order('fecha', { ascending: false })
    .limit(100);

  const t = await getTranslations('tenantFeedback');
  const rows = feedback ?? [];

  const avgScore = (field: string) => {
    const vals = rows.map((r) => (r as Record<string, unknown>)[field] as number | null).filter((v): v is number => v !== null);
    if (!vals.length) return null;
    return (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1);
  };

  const metrics = [
    { label: t('metricCleaning'), key: 'cleaning_score' },
    { label: t('metricCoexistence'), key: 'coexistence_score' },
    { label: t('metricAttention'), key: 'attention_score' },
    { label: t('metricSecurity'), key: 'security_score' },
    { label: t('metricValue'), key: 'value_score' },
  ];

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">{t('title')}</h1>
        <p className="text-sm text-slate-500 mt-1">{t('subtitle', { count: rows.length })}</p>
      </div>

      {rows.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {metrics.map(({ label, key }) => (
            <div key={key} className="bg-white rounded-xl border border-slate-200 p-4 text-center">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">{label}</p>
              <p className="text-2xl font-bold text-slate-900">{avgScore(key) ?? '—'}</p>
              <p className="text-xs text-slate-400">{t('avgLabel')}</p>
            </div>
          ))}
        </div>
      )}

      {rows.length === 0 ? (
        <Card>
          <EmptyState
            title={t('emptyTitle')}
            description={t('emptyDesc')}
          />
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
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden lg:table-cell">{t('colRecommend')}</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden lg:table-cell">{t('colComment')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((fb) => {
                const tenant = fb.tenants as { full_name: string } | null;
                return (
                  <tr key={fb.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-5 py-4 text-sm font-medium text-slate-900">{tenant?.full_name ?? '—'}</td>
                    <td className="px-5 py-4 text-sm text-slate-500 hidden sm:table-cell">{fb.fecha ?? '—'}</td>
                    <td className="px-5 py-4 text-sm"><StarScore score={fb.cleaning_score} /></td>
                    <td className="px-5 py-4 text-sm hidden md:table-cell"><StarScore score={fb.attention_score} /></td>
                    <td className="px-5 py-4 text-sm hidden lg:table-cell">
                      {fb.would_recommend === true ? (
                        <span className="text-green-600 font-medium">{t('yes')}</span>
                      ) : fb.would_recommend === false ? (
                        <span className="text-red-500 font-medium">{t('no')}</span>
                      ) : '—'}
                    </td>
                    <td className="px-5 py-4 text-sm text-slate-500 hidden lg:table-cell max-w-xs truncate">
                      {fb.comment ?? '—'}
                    </td>
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
