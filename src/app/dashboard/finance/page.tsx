import { requireAdmin } from '@/lib/auth/guards';
import { createClient } from '@/lib/supabase/server';
import { computePnL, buildCashFlow } from '@/lib/finance/reports';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import Link from 'next/link';
import type { IncomeRow, ExpenseRow } from '@/lib/finance/reports';

export default async function FinancePage() {
  const ctx = await requireAdmin();
  const supabase = await createClient();

  // Fetch approved payments (income)
  const { data: payments } = await supabase
    .from('payments')
    .select('amount, paid_at, contract_id')
    .eq('org_id', ctx.orgId)
    .eq('status', 'approved')
    .order('paid_at', { ascending: false })
    .limit(500);

  // Fetch expenses
  const { data: expenses } = await supabase
    .from('expenses')
    .select('amount, incurred_on, property_id')
    .eq('org_id', ctx.orgId)
    .order('incurred_on', { ascending: false })
    .limit(500);

  const incomeRows: IncomeRow[] = (payments ?? []).map(p => ({
    amount: p.amount,
    paid_at: p.paid_at,
  }));

  const expenseRows: ExpenseRow[] = (expenses ?? []).map(e => ({
    amount: e.amount,
    incurred_on: e.incurred_on,
    property_id: e.property_id,
  }));

  const pnl = computePnL(incomeRows, expenseRows);
  const cashFlow = buildCashFlow(incomeRows, expenseRows).slice(-20).reverse();

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-900">Finance</h1>
        <div className="flex gap-2">
          <Link href="/dashboard/finance/receipts" className="text-sm text-brand-600 hover:underline">OCR Receipts</Link>
          <Link href="/dashboard/finance/expenses/categories" className="text-sm text-brand-600 hover:underline ml-4">Categories</Link>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card padding="md">
          <p className="text-xs text-slate-500 font-medium uppercase tracking-wide">Total Income</p>
          <p className="mt-1 text-2xl font-bold text-green-600">${pnl.totalIncome.toLocaleString('en-US', { minimumFractionDigits: 2 })}</p>
        </Card>
        <Card padding="md">
          <p className="text-xs text-slate-500 font-medium uppercase tracking-wide">Total Expenses</p>
          <p className="mt-1 text-2xl font-bold text-red-600">${pnl.totalExpenses.toLocaleString('en-US', { minimumFractionDigits: 2 })}</p>
        </Card>
        <Card padding="md">
          <p className="text-xs text-slate-500 font-medium uppercase tracking-wide">Net Income</p>
          <p className={`mt-1 text-2xl font-bold ${pnl.netIncome >= 0 ? 'text-slate-900' : 'text-red-600'}`}>
            ${pnl.netIncome.toLocaleString('en-US', { minimumFractionDigits: 2 })}
          </p>
        </Card>
      </div>

      {/* P&L by Month */}
      <Card padding="md">
        <CardHeader>
          <CardTitle>P&L by Month</CardTitle>
        </CardHeader>
        {pnl.byMonth.length === 0 ? (
          <EmptyState
            title="No data yet"
            description="Approved payments and expenses will appear here."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="text-left py-2 font-medium text-slate-600">Month</th>
                  <th className="text-right py-2 font-medium text-slate-600">Income</th>
                  <th className="text-right py-2 font-medium text-slate-600">Expenses</th>
                  <th className="text-right py-2 font-medium text-slate-600">Net</th>
                </tr>
              </thead>
              <tbody>
                {pnl.byMonth.map((row) => (
                  <tr key={row.month} className="border-b border-slate-50 hover:bg-slate-50">
                    <td className="py-2 text-slate-700">{row.month}</td>
                    <td className="py-2 text-right text-green-600">${row.income.toFixed(2)}</td>
                    <td className="py-2 text-right text-red-500">${row.expenses.toFixed(2)}</td>
                    <td className={`py-2 text-right font-medium ${row.net >= 0 ? 'text-slate-900' : 'text-red-600'}`}>${row.net.toFixed(2)}</td>
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
          <CardTitle>Recent Cash Flow</CardTitle>
        </CardHeader>
        {cashFlow.length === 0 ? (
          <EmptyState title="No transactions yet" description="Income and expense entries will appear here." />
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
                  {entry.type === 'income' ? '+' : '-'}${entry.amount.toFixed(2)}
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Expenses quick link */}
      <div className="flex gap-3">
        <Link
          href="/dashboard/finance/receipts"
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium bg-brand-600 text-white rounded-lg hover:bg-brand-700 transition-colors"
        >
          View OCR Receipts
        </Link>
      </div>
    </div>
  );
}
