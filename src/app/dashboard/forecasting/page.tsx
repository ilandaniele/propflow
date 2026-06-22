import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { requireAdmin } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { units as unitsTable, payments as paymentsTable, expenses as expensesTable, contracts } from '@/lib/db/schema';
import { eq, and, gte, lte } from 'drizzle-orm';
import { getTranslations } from 'next-intl/server';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { computeOccupancy, computeTrueNetProfit } from '@/lib/finance/kpis';
import { SensitivitySlider } from '@/components/forecasting/SensitivitySlider';

export const metadata: Metadata = { title: 'Forecasting' };

export default async function ForecastingPage() {
  let ctx;
  try { ctx = await requireAdmin(); } catch { redirect('/login'); }

  const t = await getTranslations('forecasting');

  const now = new Date();
  const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);
  const lastMonthStart = new Date(lastMonthEnd.getFullYear(), lastMonthEnd.getMonth(), 1).toISOString().slice(0, 10);
  const lastMonthEndStr = lastMonthEnd.toISOString().slice(0, 10);

  const [unitRows, paymentRows, expenseRows, contractRows] = await Promise.all([
    db
      .select({ id: unitsTable.id, status: unitsTable.status, monthlyRentDefault: unitsTable.monthlyRentDefault })
      .from(unitsTable)
      .where(eq(unitsTable.orgId, ctx.orgId)),
    db
      .select({ amount: paymentsTable.amount, paidAt: paymentsTable.paidAt })
      .from(paymentsTable)
      .where(and(
        eq(paymentsTable.orgId, ctx.orgId),
        eq(paymentsTable.status, 'approved'),
        gte(paymentsTable.paidAt, lastMonthStart),
        lte(paymentsTable.paidAt, lastMonthEndStr),
      )),
    db
      .select({ amount: expensesTable.amount })
      .from(expensesTable)
      .where(and(
        eq(expensesTable.orgId, ctx.orgId),
        gte(expensesTable.incurredOn, lastMonthStart),
        lte(expensesTable.incurredOn, lastMonthEndStr),
      )),
    db
      .select({ unitId: contracts.unitId, monthlyRent: contracts.monthlyRent, status: contracts.status })
      .from(contracts)
      .where(and(eq(contracts.orgId, ctx.orgId), eq(contracts.status, 'active'))),
  ]);

  const totalUnits = unitRows.length;
  const occupiedUnits = unitRows.filter((u) => u.status === 'occupied').length;
  const baseOccupancyRate = totalUnits > 0 ? occupiedUnits / totalUnits : 0;
  const occupancyKpi = computeOccupancy(occupiedUnits, totalUnits);

  const totalIncome   = paymentRows.reduce((sum, p) => sum + Number(p.amount ?? 0), 0);
  const totalExpenses = expenseRows.reduce((sum, e) => sum + Number(e.amount ?? 0), 0);
  const netProfitKpi  = computeTrueNetProfit(totalIncome, totalExpenses);

  const monthlyRevenueAtFull =
    contractRows.length > 0
      ? contractRows.reduce((sum, c) => sum + Number(c.monthlyRent ?? 0), 0)
      : unitRows.reduce((sum, u) => sum + Number(u.monthlyRentDefault ?? 0), 0);

  const formatCurrency = (n: number) =>
    'S/ ' + Math.abs(n).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">{t('title')}</h1>
        <p className="text-sm text-slate-500 mt-1">{t('subtitle')}</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <article className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
            {t('occupancyLastMonth')}
          </p>
          <p className={`text-2xl font-bold ${occupancyKpi.value >= 0.8 ? 'text-green-700' : 'text-amber-600'}`}>
            {occupancyKpi.formatted}
          </p>
          <p className="text-xs text-slate-400">{occupiedUnits} of {totalUnits} units</p>
        </article>

        <article className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
            {t('netProfitLastMonth')}
          </p>
          <p className={`text-2xl font-bold ${netProfitKpi.value >= 0 ? 'text-green-700' : 'text-red-600'}`}>
            {netProfitKpi.formatted}
          </p>
          <p className="text-xs text-slate-400">Income − expenses</p>
        </article>

        <article className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
            {t('fullOccupancyRevenue')}
          </p>
          <p className="text-2xl font-bold text-slate-800">{formatCurrency(monthlyRevenueAtFull)}</p>
          <p className="text-xs text-slate-400">
            {contractRows.length > 0
              ? t('fromActiveContracts', { count: contractRows.length })
              : t('fromDefaultRents')}
          </p>
        </article>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('simulatorTitle')}</CardTitle>
        </CardHeader>
        {totalUnits === 0 ? (
          <p className="text-sm text-slate-400 py-4">{t('addUnitsPrompt')}</p>
        ) : (
          <SensitivitySlider
            baseNetProfit={netProfitKpi.value}
            baseOccupancyRate={baseOccupancyRate}
            monthlyRevenueAtFullOccupancy={monthlyRevenueAtFull}
            baseMonthlyExpenses={totalExpenses}
          />
        )}
      </Card>

      <p className="text-xs text-slate-400">{t('assumptionsNote')}</p>
    </div>
  );
}
