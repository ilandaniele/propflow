import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { requireAdmin } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { servicePayments, properties } from '@/lib/db/schema';
import { eq, asc, and } from 'drizzle-orm';
import { getTranslations } from 'next-intl/server';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';

export const metadata: Metadata = { title: 'Utility Payments' };

type MonthEntry = { amount: number | null; eecc: string | null; receipt_url: string | null };
type ServiceRow = {
  id: string;
  serviceType: string;
  supplyNumber: string | null;
  tope: string | null;
  monthlyData: Record<string, MonthEntry> | null;
  propertyName: string | null;
};

const SERVICE_COLORS: Record<string, string> = {
  agua:     'bg-blue-100 text-blue-700',
  luz:      'bg-yellow-100 text-yellow-700',
  gas:      'bg-orange-100 text-orange-700',
  internet: 'bg-purple-100 text-purple-700',
  otro:     'bg-slate-100 text-slate-600',
};

export default async function UtilitiesPage() {
  let ctx;
  try { ctx = await requireAdmin(); } catch { redirect('/login'); }

  const t = await getTranslations('utilities');

  const rows = await db
    .select({
      id:           servicePayments.id,
      serviceType:  servicePayments.serviceType,
      supplyNumber: servicePayments.supplyNumber,
      tope:         servicePayments.tope,
      monthlyData:  servicePayments.monthlyData,
      propertyName: properties.name,
    })
    .from(servicePayments)
    .leftJoin(properties, and(eq(properties.id, servicePayments.propertyId), eq(properties.orgId, ctx.orgId)))
    .where(eq(servicePayments.orgId, ctx.orgId))
    .orderBy(asc(servicePayments.serviceType));

  const services = rows as unknown as ServiceRow[];

  function sumMonthly(data: Record<string, MonthEntry> | null): number {
    if (!data) return 0;
    return Object.values(data).reduce((s, e) => s + (e.amount ?? 0), 0);
  }

  const now = new Date();
  const last6: string[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    last6.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }

  const byType: Record<string, number> = {};
  for (const svc of services) {
    byType[svc.serviceType] = (byType[svc.serviceType] ?? 0) + sumMonthly(svc.monthlyData);
  }

  const currentMonth = last6[last6.length - 1];
  const currentByType: Record<string, number> = {};
  for (const svc of services) {
    const entry = svc.monthlyData?.[currentMonth];
    currentByType[svc.serviceType] = (currentByType[svc.serviceType] ?? 0) + (entry?.amount ?? 0);
  }

  const overLimitServices = services.filter((svc) => {
    if (svc.tope === null) return false;
    const entry = svc.monthlyData?.[currentMonth];
    return (entry?.amount ?? 0) > Number(svc.tope);
  });
  const totalVariance = overLimitServices.reduce((s, svc) => {
    const amount = svc.monthlyData?.[currentMonth]?.amount ?? 0;
    return s + (amount - Number(svc.tope ?? 0));
  }, 0);

  const serviceTypes = ['agua', 'luz', 'gas', 'internet', 'otro'];

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">{t('title')}</h1>
        <p className="text-sm text-slate-500 mt-1">{t('subtitle', { count: services.length })}</p>
      </div>

      {/* KPI tiles — current month per service type */}
      {services.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {serviceTypes.filter((st) => currentByType[st] !== undefined).map((st) => (
            <div key={st} className="bg-white rounded-xl border border-slate-200 p-4 text-center">
              <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold mb-2 ${SERVICE_COLORS[st] ?? 'bg-slate-100 text-slate-600'}`}>
                {t(`type_${st}` as Parameters<typeof t>[0])}
              </span>
              <p className="text-xl font-bold text-slate-900">
                S/ {(currentByType[st] ?? 0).toLocaleString('es-PE', { minimumFractionDigits: 2 })}
              </p>
              <p className="text-xs text-slate-400 mt-1">{t('currentMonth')}</p>
            </div>
          ))}
        </div>
      )}

      {/* Tope variance alert */}
      {overLimitServices.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-5 py-4">
          <p className="text-sm font-semibold text-red-800 mb-1">
            {t('overLimitAlert', { count: overLimitServices.length, variance: totalVariance.toLocaleString('es-PE', { minimumFractionDigits: 2 }) })}
          </p>
          <ul className="space-y-0.5">
            {overLimitServices.map((svc) => {
              const amount = svc.monthlyData?.[currentMonth]?.amount ?? 0;
              const excess = amount - Number(svc.tope ?? 0);
              return (
                <li key={svc.id} className="text-xs text-red-700">
                  {svc.propertyName ?? '—'} · {t(`type_${svc.serviceType}` as Parameters<typeof t>[0])} — S/ {amount.toLocaleString('es-PE', { minimumFractionDigits: 2 })} ({t('overBy')} S/ {excess.toLocaleString('es-PE', { minimumFractionDigits: 2 })})
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {services.length === 0 ? (
        <Card>
          <EmptyState title={t('emptyTitle')} description={t('emptyDesc')} />
        </Card>
      ) : (
        <div className="space-y-4">
          {services.map((svc) => {
            const recentMonths = last6.filter((m) => svc.monthlyData?.[m]);
            const maxAmount    = Math.max(1, ...recentMonths.map((m) => svc.monthlyData?.[m]?.amount ?? 0));
            return (
              <div key={svc.id} className="bg-white rounded-xl border border-slate-200 p-5">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${SERVICE_COLORS[svc.serviceType] ?? 'bg-slate-100 text-slate-600'}`}>
                      {t(`type_${svc.serviceType}` as Parameters<typeof t>[0])}
                    </span>
                    <span className="text-sm font-medium text-slate-900">
                      {svc.propertyName ?? '—'}
                    </span>
                    {svc.supplyNumber && (
                      <span className="text-xs text-slate-400">#{svc.supplyNumber}</span>
                    )}
                  </div>
                  <div className="text-right">
                    {svc.tope !== null && (
                      <p className="text-xs text-slate-500">
                        {t('limit')}: <span className="font-semibold text-slate-700">S/ {Number(svc.tope).toLocaleString('es-PE', { minimumFractionDigits: 2 })}</span>
                      </p>
                    )}
                    <p className="text-xs text-slate-400">
                      {t('total')}: S/ {sumMonthly(svc.monthlyData).toLocaleString('es-PE', { minimumFractionDigits: 2 })}
                    </p>
                  </div>
                </div>

                {/* Mini bar chart — last 6 months */}
                {recentMonths.length > 0 && (
                  <div className="flex items-end gap-1 h-16">
                    {last6.map((month) => {
                      const entry     = svc.monthlyData?.[month];
                      const amount    = entry?.amount ?? 0;
                      const heightPct = amount > 0 ? Math.round((amount / maxAmount) * 100) : 0;
                      const isOverLimit = svc.tope !== null && amount > Number(svc.tope);
                      return (
                        <div key={month} className="flex-1 flex flex-col items-center gap-1">
                          <div className="w-full flex items-end justify-center" style={{ height: '48px' }}>
                            <div
                              title={`${month}: S/ ${amount.toLocaleString('es-PE', { minimumFractionDigits: 2 })}`}
                              style={{ height: `${heightPct}%`, minHeight: amount > 0 ? '4px' : '0' }}
                              className={`w-full rounded-t-sm ${isOverLimit ? 'bg-red-400' : 'bg-brand-400'} transition-all`}
                            />
                          </div>
                          <p className="text-xs text-slate-400 truncate w-full text-center">{month.slice(5)}</p>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Monthly breakdown table */}
                {recentMonths.length > 0 && (
                  <div className="mt-3 divide-y divide-slate-50">
                    {recentMonths.slice(-3).reverse().map((month) => {
                      // A service may have no data for a given recent month —
                      // guard instead of asserting non-null (which crashed on
                      // entry.amount when the entry was actually undefined).
                      const entry = svc.monthlyData?.[month];
                      if (!entry) return null;
                      const isOver = svc.tope !== null && (entry.amount ?? 0) > Number(svc.tope);
                      return (
                        <div key={month} className="flex items-center justify-between py-1.5 text-xs">
                          <span className="text-slate-500">{month}</span>
                          <div className="flex items-center gap-3">
                            <span className={`font-semibold ${isOver ? 'text-red-600' : 'text-slate-900'}`}>
                              S/ {(entry.amount ?? 0).toLocaleString('es-PE', { minimumFractionDigits: 2 })}
                            </span>
                            {entry.receipt_url && (
                              <a href={entry.receipt_url} target="_blank" rel="noreferrer" className="text-brand-600 hover:underline">
                                {t('receipt')}
                              </a>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
