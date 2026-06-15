import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { units, payments, expenses, contracts } from '@/lib/db/schema';
import { eq, and, gte, lte } from 'drizzle-orm';
import { requireAdmin } from '@/lib/auth/guards';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { computeOccupancy, computeTrueNetProfit } from '@/lib/finance/kpis';
import { SensitivitySlider } from '@/components/forecasting/SensitivitySlider';

export const metadata: Metadata = { title: 'Forecasting' };

export default async function ForecastingPage() {
  let ctx;
  try { ctx = await requireAdmin(); } catch { redirect('/login'); }

  const now = new Date();
  // Use last full calendar month as the base period for actuals
  const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0); // last day of prev month
  const lastMonthStart = new Date(
    lastMonthEnd.getFullYear(),
    lastMonthEnd.getMonth(),
    1
  );
  const lastMonthStartStr = `${lastMonthStart.getFullYear()}-${String(lastMonthStart.getMonth() + 1).padStart(2, '0')}-01`;
  const lastMonthEndStr = `${lastMonthEnd.getFullYear()}-${String(lastMonthEnd.getMonth() + 1).padStart(2, '0')}-${String(lastMonthEnd.getDate()).padStart(2, '0')}`;

  const [unitRows, paymentRows, expenseRows, contractRows] = await Promise.all([
    db.select({ id: units.id, status: units.status, monthlyRentDefault: units.monthlyRentDefault })
      .from(units)
      .where(eq(units.orgId, ctx.orgId)),
    db.select({ amount: payments.amount, paidAt: payments.paidAt })
      .from(payments)
      .where(and(
        eq(payments.orgId, ctx.orgId),
        eq(payments.status, 'approved'),
        gte(payments.paidAt, lastMonthStartStr),
        lte(payments.paidAt, lastMonthEndStr),
      )),
    db.select({ amount: expenses.amount })
      .from(expenses)
      .where(and(
        eq(expenses.orgId, ctx.orgId),
        gte(expenses.incurredOn, lastMonthStartStr),
        lte(expenses.incurredOn, lastMonthEndStr),
      )),
    db.select({ unitId: contracts.unitId, monthlyRent: contracts.monthlyRent, status: contracts.status })
      .from(contracts)
      .where(and(
        eq(contracts.orgId, ctx.orgId),
        eq(contracts.status, 'active'),
      )),
  ]);

  const totalUnits = unitRows.length;
  const occupiedUnits = unitRows.filter((u) => u.status === 'occupied').length;

  const baseOccupancyRate = totalUnits > 0 ? occupiedUnits / totalUnits : 0;
  const occupancyKpi = computeOccupancy(occupiedUnits, totalUnits);

  const totalIncome = paymentRows.reduce((sum, p) => sum + Number(p.amount ?? 0), 0);
  const totalExpenses = expenseRows.reduce((sum, e) => sum + Number(e.amount ?? 0), 0);
  const netProfitKpi = computeTrueNetProfit(totalIncome, totalExpenses);

  // Monthly revenue potential at 100% occupancy — sum of active contract rents
  // or fall back to monthly_rent_default on each unit
  const monthlyRevenueAtFull =
    contractRows.length > 0
      ? contractRows.reduce((sum, c) => sum + Number(c.monthlyRent ?? 0), 0)
      : unitRows.reduce((sum, u) => sum + Number(u.monthlyRentDefault ?? 0), 0);

  const formatCurrency = (n: number) =>
    '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Forecasting</h1>
        <p className="text-sm text-slate-500 mt-1">
          Simulate scenarios by adjusting occupancy and operating expenses. Based on last
          month&apos;s actuals.
        </p>
      </div>

      {/* Current actuals summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <article className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
            Occupancy (last month)
          </p>
          <p
            className={`text-2xl font-bold ${
              occupancyKpi.value >= 0.8 ? 'text-green-700' : 'text-amber-600'
            }`}
          >
            {occupancyKpi.formatted}
          </p>
          <p className="text-xs text-slate-400">
            {occupiedUnits} of {totalUnits} units
          </p>
        </article>

        <article className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
            Net Profit (last month)
          </p>
          <p
            className={`text-2xl font-bold ${
              netProfitKpi.value >= 0 ? 'text-green-700' : 'text-red-600'
            }`}
          >
            {netProfitKpi.formatted}
          </p>
          <p className="text-xs text-slate-400">Income − expenses</p>
        </article>

        <article className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
            Full Occupancy Revenue
          </p>
          <p className="text-2xl font-bold text-slate-800">
            {formatCurrency(monthlyRevenueAtFull)}
          </p>
          <p className="text-xs text-slate-400">
            {contractRows.length > 0
              ? `From ${contractRows.length} active contracts`
              : 'From unit default rents'}
          </p>
        </article>
      </div>

      {/* Sensitivity simulator */}
      <Card>
        <CardHeader>
          <CardTitle>Sensitivity Simulator</CardTitle>
        </CardHeader>
        {totalUnits === 0 ? (
          <p className="text-sm text-slate-400 py-4">
            Add units and contracts to enable the forecasting simulator.
          </p>
        ) : (
          <SensitivitySlider
            baseNetProfit={netProfitKpi.value}
            baseOccupancyRate={baseOccupancyRate}
            monthlyRevenueAtFullOccupancy={monthlyRevenueAtFull}
            baseMonthlyExpenses={totalExpenses}
          />
        )}
      </Card>

      {/* Assumptions note */}
      <p className="text-xs text-slate-400">
        Projections use last month&apos;s actuals as the baseline. The model assumes revenue scales
        linearly with occupancy and that operating expenses change proportionally with the OpEx
        slider. This is a simplified model — actual results may differ.
      </p>
    </div>
  );
}
