import { requireAdmin } from '@/lib/auth/guards';
import { createClient } from '@/lib/supabase/server';
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
  const supabase = await createClient();
  const t = await getTranslations('finance');

  // ── Date ranges ──────────────────────────────────────────────────────────
  const now = new Date();
  const currentMonthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  const priorMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const priorMonthStart = `${priorMonthDate.getFullYear()}-${String(priorMonthDate.getMonth() + 1).padStart(2, '0')}-01`;

  // ── Income (approved payments) ────────────────────────────────────────────
  const { data: payments } = await supabase
    .from('payments')
    .select('amount, paid_at, contract_id')
    .eq('org_id', ctx.orgId)
    .eq('status', 'approved')
    .order('paid_at', { ascending: false })
    .limit(500);

  // Current month income
  const { data: currentPayments } = await supabase
    .from('payments')
    .select('amount')
    .eq('org_id', ctx.orgId)
    .eq('status', 'approved')
    .gte('paid_at', currentMonthStart)
    .limit(500);

  // Prior month income
  const { data: priorPayments } = await supabase
    .from('payments')
    .select('amount')
    .eq('org_id', ctx.orgId)
    .eq('status', 'approved')
    .gte('paid_at', priorMonthStart)
    .lt('paid_at', currentMonthStart)
    .limit(500);

  // ── Expenses (with category name joined) ─────────────────────────────────
  const { data: expenses } = await supabase
    .from('expenses')
    .select('amount, incurred_on, property_id, expense_categories(name)')
    .eq('org_id', ctx.orgId)
    .order('incurred_on', { ascending: false })
    .limit(500);

  // Current month expenses
  const { data: currentExpenses } = await supabase
    .from('expenses')
    .select('amount, expense_categories(name)')
    .eq('org_id', ctx.orgId)
    .gte('incurred_on', currentMonthStart)
    .limit(500);

  // Prior month expenses
  const { data: priorExpenses } = await supabase
    .from('expenses')
    .select('amount, expense_categories(name)')
    .eq('org_id', ctx.orgId)
    .gte('incurred_on', priorMonthStart)
    .lt('incurred_on', currentMonthStart)
    .limit(500);

  // ── Occupancy ─────────────────────────────────────────────────────────────
  const { count: totalUnits } = await supabase
    .from('units')
    .select('id', { count: 'exact', head: true })
    .eq('org_id', ctx.orgId);

  const { count: occupiedUnits } = await supabase
    .from('contracts')
    .select('unit_id', { count: 'exact', head: true })
    .eq('org_id', ctx.orgId)
    .eq('status', 'active');

  // ── Past Due Balance ──────────────────────────────────────────────────────
  const today = now.toISOString().slice(0, 10);
  const { data: overdueCharges } = await supabase
    .from('charges')
    .select('amount')
    .eq('org_id', ctx.orgId)
    .lt('due_date', today)
    .eq('status', 'pending')
    .limit(500);

  // ── Map rows ─────────────────────────────────────────────────────────────
  const incomeRows: IncomeRow[] = (payments ?? []).map((p) => ({
    amount: p.amount,
    paid_at: p.paid_at,
  }));

  const expenseRows: ExpenseRow[] = (expenses ?? []).map((e) => ({
    amount: e.amount,
    incurred_on: e.incurred_on,
    property_id: e.property_id,
  }));

  // Supabase join returns expense_categories as an object (many-to-one) or array.
  // We cast via unknown to handle the generated type mismatch.
  const mapWithCategory = (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase join returns expense_categories as object or array; no generic type resolves this mixed shape
    rows: any[] | null
  ): ExpenseWithCategory[] =>
    (rows ?? []).map((e) => {
      // Supabase may return the FK join as object or first element of array
      const cat = Array.isArray(e.expense_categories)
        ? (e.expense_categories[0] as { name: string } | undefined)
        : (e.expense_categories as { name: string } | null | undefined);
      return {
        amount: e.amount as number,
        category_name: cat?.name ?? null,
      };
    });

  const currentExpensesWithCat = mapWithCategory(currentExpenses);
  const priorExpensesWithCat = mapWithCategory(priorExpenses);

  const currentIncome = (currentPayments ?? []).reduce((s, p) => s + p.amount, 0);
  const priorIncome = (priorPayments ?? []).reduce((s, p) => s + p.amount, 0);
  const currentExpTotal = currentExpensesWithCat.reduce((s, e) => s + e.amount, 0);
  const priorExpTotal = priorExpensesWithCat.reduce((s, e) => s + e.amount, 0);

  const overdueAmounts = (overdueCharges ?? []).map((c) => c.amount);

  // ── KPI computations ─────────────────────────────────────────────────────
  const trueNetProfit = computeTrueNetProfit(
    currentIncome, currentExpTotal,
    priorIncome, priorExpTotal
  );
  const turnCost = computeTurnCost(
    currentExpensesWithCat,
    priorExpensesWithCat.filter((e) => e.category_name === 'turn_costs').reduce((s, e) => s + e.amount, 0)
  );
  const capEx = computeCapEx(
    currentExpensesWithCat,
    priorExpensesWithCat.filter((e) => e.category_name === 'capex').reduce((s, e) => s + e.amount, 0)
  );
  const debtService = computeDebtService(
    currentExpensesWithCat,
    priorExpensesWithCat.filter((e) => e.category_name === 'debt_service').reduce((s, e) => s + e.amount, 0)
  );
  const platformFees = computePlatformFees(
    currentExpensesWithCat,
    priorExpensesWithCat.filter((e) => e.category_name === 'platform_fees').reduce((s, e) => s + e.amount, 0)
  );
  const occupancy = computeOccupancy(
    occupiedUnits ?? 0, totalUnits ?? 0
  );
  const pastDue = computePastDueBalance(overdueAmounts);

  // ── 12-month trend ────────────────────────────────────────────────────────
  const trendData = computePnLByMonth(incomeRows, expenseRows, 12);

  // ── Legacy P&L report ─────────────────────────────────────────────────────
  const pnl = computePnL(incomeRows, expenseRows);
  const cashFlow = buildCashFlow(incomeRows, expenseRows).slice(-20).reverse();

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-900">{t('title')}</h1>
        <div className="flex gap-2 flex-wrap">
          <Link href="/dashboard/finance/rooms" className="text-sm text-brand-600 hover:underline">
            {t('roomProfitability')}
          </Link>
          <Link href="/dashboard/finance/receipts" className="text-sm text-brand-600 hover:underline ml-4">
            {t('ocrReceipts')}
          </Link>
          <Link href="/dashboard/finance/expenses/categories" className="text-sm text-brand-600 hover:underline ml-4">
            {t('categories')}
          </Link>
        </div>
      </div>

      {/* ── AC22: New KPI tiles row ────────────────────────────────────────── */}
      <div data-testid="finance-kpi-tiles">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
          {t('kpiTitle')}
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-4">
          <KpiTile
            label={t('kpis.trueNetProfit')}
            value={trueNetProfit.formatted}
            rawValue={trueNetProfit.value}
            delta={trueNetProfit.delta}
            positiveIsGood={true}
            testId="kpi-true-net-profit"
          />
          <KpiTile
            label={t('kpis.turnCost')}
            value={turnCost.formatted}
            rawValue={turnCost.value}
            delta={turnCost.delta}
            positiveIsGood={false}
            testId="kpi-turn-cost"
          />
          <KpiTile
            label={t('kpis.capEx')}
            value={capEx.formatted}
            rawValue={capEx.value}
            delta={capEx.delta}
            positiveIsGood={false}
            testId="kpi-capex"
          />
          <KpiTile
            label={t('kpis.debtService')}
            value={debtService.formatted}
            rawValue={debtService.value}
            delta={debtService.delta}
            positiveIsGood={false}
            testId="kpi-debt-service"
          />
          <KpiTile
            label={t('kpis.platformFees')}
            value={platformFees.formatted}
            rawValue={platformFees.value}
            delta={platformFees.delta}
            positiveIsGood={false}
            testId="kpi-platform-fees"
          />
          <KpiTile
            label={t('kpis.occupancy')}
            value={occupancy.formatted}
            rawValue={occupancy.value}
            delta={occupancy.delta}
            positiveIsGood={true}
            testId="kpi-occupancy"
          />
          <KpiTile
            label={t('kpis.pastDue')}
            value={pastDue.formatted}
            rawValue={pastDue.value}
            delta={pastDue.delta}
            positiveIsGood={false}
            testId="kpi-past-due"
          />
        </div>
      </div>

      {/* ── AC24: 12-month Trend Chart ─────────────────────────────────────── */}
      <Card padding="md">
        <CardHeader>
          <CardTitle>{t('trend.cardTitle')}</CardTitle>
        </CardHeader>
        <TrendChart
          data={trendData}
          labels={{
            revenue: t('trend.revenue'),
            expenses: t('trend.expenses'),
            netProfit: t('trend.netProfit'),
            title: t('trend.title'),
            noData: t('trend.noData'),
          }}
        />
      </Card>

      {/* Legacy: Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card padding="md">
          <p className="text-xs text-slate-500 font-medium uppercase tracking-wide">{t('totalIncome')}</p>
          <p className="mt-1 text-2xl font-bold text-green-600">
            ${pnl.totalIncome.toLocaleString('en-US', { minimumFractionDigits: 2 })}
          </p>
        </Card>
        <Card padding="md">
          <p className="text-xs text-slate-500 font-medium uppercase tracking-wide">{t('totalExpenses')}</p>
          <p className="mt-1 text-2xl font-bold text-red-600">
            ${pnl.totalExpenses.toLocaleString('en-US', { minimumFractionDigits: 2 })}
          </p>
        </Card>
        <Card padding="md">
          <p className="text-xs text-slate-500 font-medium uppercase tracking-wide">{t('netIncome')}</p>
          <p className={`mt-1 text-2xl font-bold ${pnl.netIncome >= 0 ? 'text-slate-900' : 'text-red-600'}`}>
            ${pnl.netIncome.toLocaleString('en-US', { minimumFractionDigits: 2 })}
          </p>
        </Card>
      </div>

      {/* P&L by Month */}
      <Card padding="md">
        <CardHeader>
          <CardTitle>{t('pnlByMonth')}</CardTitle>
        </CardHeader>
        {pnl.byMonth.length === 0 ? (
          <EmptyState
            title={t('noData')}
            description={t('noDataDesc')}
          />
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
                    <td className="py-2 text-right text-green-600">${row.income.toFixed(2)}</td>
                    <td className="py-2 text-right text-red-500">${row.expenses.toFixed(2)}</td>
                    <td className={`py-2 text-right font-medium ${row.net >= 0 ? 'text-slate-900' : 'text-red-600'}`}>
                      ${row.net.toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Cash Flow Timeline */}
      <Card padding="md">
        <CardHeader>
          <CardTitle>{t('recentCashFlow')}</CardTitle>
        </CardHeader>
        {cashFlow.length === 0 ? (
          <EmptyState title={t('noTransactions')} description={t('noTransactionsDesc')} />
        ) : (
          <div className="space-y-1 max-h-64 overflow-y-auto">
            {cashFlow.map((entry, i) => (
              <div key={i} className="flex items-center justify-between py-1.5 border-b border-slate-50 last:border-0">
                <div className="flex items-center gap-2">
                  <span
                    className={`w-2 h-2 rounded-full ${entry.type === 'income' ? 'bg-green-500' : 'bg-red-400'}`}
                    aria-hidden="true"
                  />
                  <span className="text-sm text-slate-700">{entry.date}</span>
                  <span className="text-xs text-slate-500">{entry.label}</span>
                </div>
                <span className={`text-sm font-medium ${entry.type === 'income' ? 'text-green-600' : 'text-red-500'}`}>
                  {entry.type === 'income' ? '+' : '-'}${entry.amount.toFixed(2)}
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Quick links */}
      <div className="flex gap-3 flex-wrap">
        <Link
          href="/dashboard/finance/rooms"
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium bg-brand-600 text-white rounded-lg hover:bg-brand-700 transition-colors"
        >
          {t('viewRoomProfitability')}
        </Link>
        <Link
          href="/dashboard/finance/receipts"
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium border border-slate-200 text-slate-700 rounded-lg hover:bg-slate-50 transition-colors"
        >
          {t('viewOcrReceipts')}
        </Link>
      </div>
    </div>
  );
}
