import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/auth/guards';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';

export const metadata: Metadata = { title: 'Tax Receipts' };

function statusClass(status: string | null): string {
  switch (status) {
    case 'issued':    return 'bg-green-100 text-green-700';
    case 'cancelled': return 'bg-red-100 text-red-700';
    case 'draft':     return 'bg-slate-100 text-slate-600';
    default:          return 'bg-amber-100 text-amber-700';
  }
}

export default async function TaxReceiptsPage() {
  let ctx;
  try { ctx = await requireAdmin(); } catch { redirect('/login'); }

  const supabase = await createClient();
  const { data: receipts } = await supabase
    .from('tax_receipts')
    .select('*')
    .eq('org_id', ctx.orgId)
    .order('anio', { ascending: false })
    .order('mes', { ascending: false })
    .limit(100);

  const rows = receipts ?? [];
  const totalAmount = rows.reduce((sum, r) => sum + (r.total_amount ?? 0), 0);

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Tax Receipts</h1>
          <p className="text-sm text-slate-500 mt-1">
            {rows.length} receipt{rows.length !== 1 ? 's' : ''} · Total S/ {totalAmount.toLocaleString('es-PE', { minimumFractionDigits: 2 })}
          </p>
        </div>
      </div>

      {rows.length === 0 ? (
        <Card>
          <EmptyState
            title="No tax receipts"
            description="Tax receipts and vouchers (Impuestos/Comprobantes) synced from Airtable will appear here."
          />
        </Card>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full" aria-label="Tax receipts list">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Code</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden sm:table-cell">Type</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden sm:table-cell">Period</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Total (S/)</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden md:table-cell">IGV</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden lg:table-cell">Issue Date</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((receipt) => {
                const period = receipt.mes && receipt.anio ? `${receipt.mes} ${receipt.anio}` : '—';
                return (
                  <tr key={receipt.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-5 py-4 text-sm font-medium text-slate-900">{receipt.receipt_code ?? receipt.numero ?? '—'}</td>
                    <td className="px-5 py-4 text-sm text-slate-500 hidden sm:table-cell capitalize">{receipt.tipo ?? '—'}</td>
                    <td className="px-5 py-4 text-sm text-slate-500 hidden sm:table-cell">{period}</td>
                    <td className="px-5 py-4 text-sm font-semibold text-slate-900">
                      S/ {(receipt.total_amount ?? 0).toLocaleString('es-PE', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="px-5 py-4 text-sm text-slate-500 hidden md:table-cell">
                      {receipt.includes_igv ? `S/ ${(receipt.igv_amount ?? 0).toLocaleString('es-PE', { minimumFractionDigits: 2 })}` : '—'}
                    </td>
                    <td className="px-5 py-4 text-sm text-slate-500 hidden lg:table-cell">{receipt.issue_date ?? '—'}</td>
                    <td className="px-5 py-4">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${statusClass(receipt.status)}`}>
                        {receipt.status ?? 'unknown'}
                      </span>
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
