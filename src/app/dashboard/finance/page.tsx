import { requireAdmin } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import {
  payments as paymentsTable,
  expenses as expensesTable,
  expenseCategories,
  units,
  contracts,
  charges,
} from '@/lib/db/schema';
import { eq, gte, lt, and, desc } from 'drizzle-orm';
import { computePnL, buildCashFlow, computePnLByMonth } from '@/lib/finance/reports';
import {
  computeTrueNetProfit,
  computeTurnCost,
  computeCapEx,
  computeDebtService,
  computePlatformFees,
  computeOccupancy,
  computePastDueBalance,
} from '@/lib/finance/kpis';
import { KpiTile } from '@/components/finance/KpiTile';
import { TrendChart } from '@/components/finance/TrendChart';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import type { IncomeRow, ExpenseRow } from '@/lib/finance/reports';
import type { ExpenseWithCategory } from '@/lib/finance/kpis';

export default async function FinancePage() {
  const ctx = await requireAdmin();
  const t = await getTranslations('finance');

  const now = new Date();
  const cm1 = String(now.getMonth() + 1).padStart(2, '0');
  const currentMonthStart = `${now.getFullYear()}-${cm1}-01`;
  const priorMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const pm1 = String(priorMonthDate.getMonth() + 1).padStart(2, '0');
  const priorMonthStart = `${priorMonthDate.getFullYear()}-${pm1}-01`;
  const today = now.toISOString().slice(0, 10);

  const [
    allPayments,
    currentPayments,
    priorPayments,
    allExpenses,
    currentExpenses,
    priorExpenses,
    totalUnitsRows,
    occupiedContracts,
    overdueCharges,
  ] = await Promise.all([
    db
      .select({ amount: paymentsTable.amount, paidAt: paymentsTable.paidAt, contractId: paymentsTable.contractId })
      .from(paymentsTable)
      .where(and(eq(paymentsTable.orgId, ctx.orgId), eq(paymentsTable.status, 'approved')))
      .orderBy(desc(paymentsTable.paidAt))
      .limit(500),
    db
      .select({ amount: paymentsTable.amount })
      .from(paymentsTable)
      .where(and(eq(paymentsTable.orgId, ctx.orgId), eq(paymentsTable.status, 'approved'), gte(paymentsTable.paidAt, currentMonthStart)))
      .limit(500),
    db
      .select({ amount: paymentsTable.amount })
      .from(paymentsTable)
      .where(and(eq(paymentsTable.orgId, ctx.orgId), eq(paymentsTable.status, 'approved'), gte(paymentsTable.paidAt, priorMonthStart), lt(paymentsTable.paidAt, currentMonthStart)))
      .limit(500),
    db
      .select({ amount: expensesTable.amount, incurredOn: expensesTable.incurredOn, propertyId: expensesTable.propertyId, categoryName: expenseCategories.name })
      .from(expensesTable)
      .leftJoin(expenseCategories, eq(expenseCategories.id, expensesTable.categoryId))
      .where(eq(expensesTable.orgId, ctx.orgId))
      .orderBy(desc(expensesTable.incurredOn))
      .limit(500),
    db
      .select({ amount: expensesTable.amount, categoryName: expenseCategories.name })
      .from(expensesTable)
      .leftJoin(expenseCategories, eq(expenseCategories.id, expensesTable.categoryId))
      .where(and(eq(expensesTable.orgId, ctx.orgId), gte(expensesTable.incurredOn, currentMonthStart)))
      .limit(500),
    db
      .select({ amount: expensesTable.amount, categoryName: expenseCategories.name })
      .from(expensesTable)
      .leftJoin(expenseCategories, eq(expenseCategories.id, expensesTable.categoryId))
      .where(and(eq(expensesTable.orgId, ctx.orgId), gte(expensesTable.incurredOn, priorMonthStart), lt(expensesTable.incurredOn, currentMonthStart)))
      .limit(500),
    db.select({ id: units.id }).from(units).where(eq(units.orgId, ctx.orgId)),
    db
      .select({ unitId: contracts.unitId })
      .from(contracts)
      .where(and(eq(contracts.orgId, ctx.orgId), eq(contracts.status, 'active'))),
    db
      .select({ amount: charges.amount })
      .from(charges)
      .where(and(eq(charges.orgId, ctx.orgId), lt(charges.dueDate, today)))
      .limit(500),
  ]);

  const incomeRows: IncomeRow[] = allPayments.map((p) => ({ amount: p.amount, paid_at: p.paidAt }));
  const expenseRows: ExpenseRow[] = allExpenses.map((e) => ({ amount: e.amount, incurred_on: e.incurredOn, property_id: e.propertyId }));

  type RawExp = { amount: unknown; categoryName: string | null };
  const toExpenseWithCat = (rows: RawExp[]): ExpenseWithCategory[] =>
    rows.map((e) => ({ amount: Number(e.amount), category_name: e.categoryName ?? null }));

  const currentExpensesWithCat = toExpenseWithCat(currentExpenses as unknown as RawExp[]);
  const priorExpensesWithCat   = toExpenseWithCat(priorExpenses as unknown as RawExp[]);

  const currentIncome   = currentPayments.reduce((s, p) => s + Number(p.amount), 0);
  const priorIncome     = priorPayments.reduce((s, p) => s + Number(p.amount), 0);
  const currentExpTotal = currentExpensesWithCat.reduce((s, e) => s + e.amount, 0);
  const priorExpTotal   = priorExpensesWithCat.reduce((s, e) => s + e.amount, 0);
  const overdueAmounts  = overdueCharges.map((c) => Number(c.amount));

  const trueNetProfit = computeTrueNetProfit(currentIncome, currentExpTotal, priorIncome, priorExpTotal);
  const turnCost    = computeTurnCost(currentExpensesWithCat, priorExpensesWithCat.filter((e) => e.category_name === 'turn_costs').reduce((s, e) => s + e.amount, 0));
  const capEx       = computeCapEx(currentExpensesWithCat, priorExpensesWithCat.filter((e) => e.category_name === 'capex').reduce((s, e) => s + e.amount, 0));
  const debtService = computeDebtService(currentExpensesWithCat, priorExpensesWithCat.filter((e) => e.category_name === 'debt_service').reduce((s, e) => s + e.amount, 0));
  const platformFees = computePlatformFees(currentExpensesWithCat, priorExpensesWithCat.filter((e) => e.category_name === 'platform_fees').reduce((s, e) => s + e.amount, 0));
  const occupancy = computeOccupancy(occupiedContracts.length, totalUnitsRows.length);
  const pastDue   = computePastDueBalance(overdueAmounts);

  const trendData = computePnLByMonth(incomeRows, expenseRows, 12);
  const pnl       = computePnL(incomeRows, expenseRows);
  const cashFlow  = buildCashFlow(incomeRows, expenseRows).slice(-20).reverse();

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-900">{t('title')}</h1>
        <div className="flex gap-2 flex-wrap">
          <Link href="/dashboard/finance/rooms" className="text-sm text-brand-600 hover:underline">{t('roomProfitability')}</Link>
          <Link href="/dashboard/finance/receipts" className="text-sm text-brand-600 hover:underline ml-4">{t('ocrReceipts')}</Link>
          <Link href="/dashboard/finance/expenses/categories" className="text-sm text-brand-600 hover:underline ml-4">{t('categories')}</Link>
        </div>
      </div>

      <div data-testid="finance-kpi-tiles">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">{t('kpiTitle')}</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-4">
          <KpiTile label={t('kpis.trueNetProfit')} value={trueNetProfit.formatted} rawValue={trueNetProfit.value} delta={trueNetProfit.delta} positiveIsGood={true} testId="kpi-true-net-profit" deltaSuffix={t('kpis.deltaSuffix')} noPriorData={t('kpis.noPriorData')} />
          <KpiTile label={t('kpis.turnCost')} value={turnCost.formatted} rawValue={turnCost.value} delta={turnCost.delta} positiveIsGood={false} testId="kpi-turn-cost" deltaSuffix={t('kpis.deltaSuffix')} noPriorData={t('kpis.noPriorData')} />
          <KpiTile label={t('kpis.capEx')} value={capEx.formatted} rawValue={capEx.value} delta={capEx.delta} positiveIsGood={false} testId="kpi-capex" deltaSuffix={t('kpis.deltaSuffix')} noPriorData={t('kpis.noPriorData')} />
          <KpiTile label={t('kpis.debtService')} value={debtService.formatted} rawValue={debtService.value} delta={debtService.delta} positiveIsGood={false} testId="kpi-debt-service" deltaSuffix={t('kpis.deltaSuffix')} noPriorData={t('kpis.noPriorData')} />
          <KpiTile label={t('kpis.platformFees')} value={platformFees.formatted} rawValue={platformFees.value} delta={platformFees.delta} positiveIsGood={false} testId="kpi-platform-fees" deltaSuffix={t('kpis.deltaSuffix')} noPriorData={t('kpis.noPriorData')} />
          <KpiTile label={t('kpis.occupancy')} value={occupancy.formatted} rawValue={occupancy.value} delta={occupancy.delta} positiveIsGood={true} testId="kpi-occupancy" deltaSuffix={t('kpis.deltaSuffix')} noPriorData={t('kpis.noPriorData')} />
          <KpiTile label={t('kpis.pastDue')} value={pastDue.formatted} rawValue={pastDue.value} delta={pastDue.delta} positiveIsGood={false} testId="kpi-past-due" deltaSuffix={t('kpis.deltaSuffix')} noPriorData={t('kpis.noPriorData')} />
        </div>
      </div>

      <Card padding="md">
        <CardHeader><CardTitle>{t('trend.cardTitle')}</CardTitle></CardHeader>
        <TrendChart data={trendData} labels={{ revenue: t('trend.revenue'), expenses: t('trend.expenses'), netProfit: t('trend.netProfit'), title: t('trend.title'), noData: t('trend.noData') }} />
      </Card>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card padding="md">
          <p className="text-xs text-slate-500 font-medium uppercase tracking-wide">{t('totalIncome')}</p>
          <p className="mt-1 text-2xl font-bold text-green-600">S/ {pnl.totalIncome.toLocaleString('es-PE', { minimumFractionDigits: 2 })}</p>
        </Card>
        <Card padding="md">
          <p className="text-xs text-slate-500 font-medium uppercase tracking-wide">{t('totalExpenses')}</p>
          <p className="mt-1 text-2xl font-bold text-red-600">S/ {pnl.totalExpenses.toLocaleString('es-PE', { minimumFractionDigits: 2 })}</p>
        </Card>
        <Card padding="md">
          <p className="text-xs text-slate-500 font-medium uppercase tracking-wide">{t('netIncome')}</p>
          <p className={`mt-1 text-2xl font-bold ${pnl.netIncome >= 0 ? 'text-slate-900' : 'text-red-600'}`}>S/ {pnl.netIncome.toLocaleString('es-PE', { minimumFractionDigits: 2 })}</p>
        </Card>
      </div>

      <Card padding="md">
        <CardHeader><CardTitle>{t('pnlByMonth')}</CardTitle></CardHeader>
        {pnl.byMonth.length === 0 ? (
          <EmptyState title={t('noData')} description={t('noDataDesc')} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="text-left py-2 font-medium text-slate-600">{t('month')}</th>
                  <th className="text-right py-2 font-medium text-slate-600">{t('income')}</th>
                  <th className="text-right py-2 font-medium text-slate-600">{t('expenses')}</th>
                  <th className="text-right py-2 font-medium text-slate-600">{t('net')}</th>
                </tr>
              </thead>
              <tbody>
                {pnl.byMonth.map((row) => (
                  <tr key={row.month} className="border-b border-slate-50 hover:bg-slate-50">
                    <td className="py-2 text-slate-700">{row.month}</td>
                    <td className="py-2 text-right text-green-600">S/ {row.income.toFixed(2)}</td>
                    <td className="py-2 text-right text-red-500">S/ {row.expenses.toFixed(2)}</td>
                    <td className={`py-2 text-right font-medium ${row.net >= 0 ? 'text-slate-900' : 'text-red-600'}`}>S/ {row.net.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card padding="md">
        <CardHeader><CardTitle>{t('recentCashFlow')}</CardTitle></CardHeader>
        {cashFlow.length === 0 ? (
          <EmptyState title={t('noTransactions')} description={t('noTransactionsDesc')} />
        ) : (
          <div className="space-y-1 max-h-64 overflow-y-auto">
            {cashFlow.map((entry, i) => (
              <div key={i} className="flex items-center justify-between py-1.5 border-b border-slate-50 last:border-0">
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${entry.type === 'income' ? 'bg-green-500' : 'bg-red-400'}`} aria-hidden="true" />
                  <span className="text-sm text-slate-700">{entry.date}</span>
                  <span className="text-xs text-slate-500">{entry.label}</span>
                </div>
                <span className={`text-sm font-medium ${entry.type === 'income' ? 'text-green-600' : 'text-red-500'}`}>
                  {entry.type === 'income' ? '+' : '-'}S/ {entry.amount.toFixed(2)}
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>

      <div className="flex gap-3 flex-wrap">
        <Link href="/dashboard/finance/rooms" className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium bg-brand-600 text-white rounded-lg hover:bg-brand-700 transition-colors">{t('viewRoomProfitability')}</Link>
        <Link href="/dashboard/finance/receipts" className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium border border-slate-200 text-slate-700 rounded-lg hover:bg-slate-50 transition-colors">{t('viewOcrReceipts')}</Link>
      </div>
    </div>
  );
}
