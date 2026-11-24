import { requireAdmin } from '@/lib/auth/guards';
import { getTranslations } from 'next-intl/server';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { listPeriodCloses } from '@/lib/period-close/queries';
import { ClosePeriodForm, ReopenPeriodForm } from './ClosingForms';

function previousMonth(now: Date): string {
  const date = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export default async function PeriodClosingPage() {
  const ctx = await requireAdmin();
  const t = await getTranslations('periodClose');
  const closes = await listPeriodCloses(ctx.orgId);

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">{t('title')}</h1>
        <p className="text-sm text-slate-600 mt-1">{t('subtitle')}</p>
      </div>

      <Card padding="md">
        <h2 className="text-base font-medium text-slate-800 mb-4">{t('closeTitle')}</h2>
        <ClosePeriodForm defaultPeriod={previousMonth(new Date())} />
      </Card>

      {closes.length === 0 ? (
        <EmptyState title={t('emptyTitle')} description={t('emptyDesc')} />
      ) : (
        <Card padding="none">
          <ul className="divide-y divide-slate-100">
            {closes.map((close) => (
              <li key={close.period} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="font-medium text-slate-900 tabular-nums">{close.period}</p>
                  <p className="text-xs text-slate-500">
                    {t('closedOn', { date: close.closedAt.toLocaleDateString(), name: close.closedByName ?? '—' })}
                  </p>
                  {close.note && <p className="text-sm text-slate-600 mt-1">{close.note}</p>}
                </div>
                <ReopenPeriodForm period={close.period} />
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
