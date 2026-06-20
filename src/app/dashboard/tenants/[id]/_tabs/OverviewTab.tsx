import { getTranslations } from 'next-intl/server';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { StatusPill } from '@/components/ui/Badge';

interface OverviewTabProps {
  statement: { total_charges: number; total_approved_payments: number; balance: number; is_overdue: boolean } | null;
  activeContract: { monthly_rent: number; start_date: string; end_date: string | null; status: string } | null;
  activeIncidentsCount: number;
  pendingTasksCount: number;
  lastWhatsAppMessage: { body: string | null; created_at: string } | null;
  tenantId: string;
}

export async function OverviewTab({ statement, activeContract, activeIncidentsCount, pendingTasksCount, lastWhatsAppMessage }: OverviewTabProps) {
  const t = await getTranslations('tenantTabs.overviewTab');
  return (
    <div className="p-4 space-y-4">
      {/* Financial summary */}
      <Card>
        <CardHeader><CardTitle>{t('financialTitle')}</CardTitle></CardHeader>
        {statement ? (
          <dl className="grid grid-cols-3 gap-4 text-sm">
            <div className="text-center">
              <dt className="text-slate-500 text-xs mb-1">{t('totalCharged')}</dt>
              <dd className="font-semibold text-slate-900">S/ {statement.total_charges.toLocaleString('es-PE', { minimumFractionDigits: 2 })}</dd>
            </div>
            <div className="text-center">
              <dt className="text-slate-500 text-xs mb-1">{t('totalPaid')}</dt>
              <dd className="font-semibold text-green-600">S/ {statement.total_approved_payments.toLocaleString('es-PE', { minimumFractionDigits: 2 })}</dd>
            </div>
            <div className="text-center">
              <dt className="text-slate-500 text-xs mb-1">{t('balance')}</dt>
              <dd className={`font-bold text-base ${statement.balance < 0 ? 'text-red-600' : 'text-green-600'}`}>
                {statement.balance < 0 ? '-' : ''}S/ {Math.abs(statement.balance).toLocaleString('es-PE', { minimumFractionDigits: 2 })}
              </dd>
            </div>
          </dl>
        ) : (
          <p className="text-sm text-slate-400">{t('noFinancialData')}</p>
        )}
      </Card>

      {/* Active contract */}
      <Card>
        <CardHeader><CardTitle>{t('contractTitle')}</CardTitle></CardHeader>
        {activeContract ? (
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-slate-500">{t('monthlyRent')}</dt>
              <dd className="font-medium">S/ {activeContract.monthly_rent.toLocaleString('es-PE', { minimumFractionDigits: 2 })}{t('perMonth')}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">{t('period')}</dt>
              <dd>{activeContract.start_date} → {activeContract.end_date ?? '—'}</dd>
            </div>
            <div className="flex justify-between items-center">
              <dt className="text-slate-500">{t('status')}</dt>
              <dd><StatusPill status={activeContract.status} /></dd>
            </div>
          </dl>
        ) : (
          <p className="text-sm text-slate-400">{t('noActiveContract')}</p>
        )}
      </Card>

      {/* Quick stats */}
      <div className="grid grid-cols-2 gap-4">
        <Card>
          <div className="text-center py-2">
            <div className="text-2xl font-bold text-slate-900">{activeIncidentsCount}</div>
            <div className="text-xs text-slate-500 mt-1">{t('activeIncidents')}</div>
          </div>
        </Card>
        <Card>
          <div className="text-center py-2">
            <div className="text-2xl font-bold text-slate-900">{pendingTasksCount}</div>
            <div className="text-xs text-slate-500 mt-1">{t('pendingTasks')}</div>
          </div>
        </Card>
      </div>

      {/* Last WhatsApp */}
      {lastWhatsAppMessage && (
        <Card>
          <CardHeader><CardTitle>{t('lastWhatsApp')}</CardTitle></CardHeader>
          <div className="text-sm text-slate-700 line-clamp-2">{lastWhatsAppMessage.body ?? t('attachment')}</div>
          <div className="text-xs text-slate-400 mt-1">{new Date(lastWhatsAppMessage.created_at).toLocaleString()}</div>
        </Card>
      )}
    </div>
  );
}
