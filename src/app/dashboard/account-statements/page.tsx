import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/auth/guards';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';

export const metadata: Metadata = { title: 'Account Statements' };

const SEND_STATUS_LABEL: Record<string, string> = {
  sent: 'Sent',
  pending: 'Pending',
  error: 'Error',
  draft: 'Draft',
};

function statusClass(status: string | null): string {
  switch (status) {
    case 'sent':    return 'bg-green-100 text-green-700';
    case 'error':   return 'bg-red-100 text-red-700';
    case 'pending': return 'bg-amber-100 text-amber-700';
    default:        return 'bg-slate-100 text-slate-600';
  }
}

export default async function AccountStatementsPage() {
  let ctx;
  try { ctx = await requireAdmin(); } catch { redirect('/login'); }

  const supabase = await createClient();
  const { data: statements } = await supabase
    .from('account_statements')
    .select('*, contracts(id, tenants(full_name))')
    .eq('org_id', ctx.orgId)
    .order('anio', { ascending: false })
    .order('mes', { ascending: false })
    .limit(100);

  const rows = statements ?? [];
  const sentCount = rows.filter((r) => r.send_status === 'sent').length;
  const totalDue = rows.reduce((sum, r) => sum + (r.total_due ?? 0), 0);

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Account Statements</h1>
          <p className="text-sm text-slate-500 mt-1">
            {rows.length} statement{rows.length !== 1 ? 's' : ''} · {sentCount} sent · Total due S/ {totalDue.toLocaleString('es-PE', { minimumFractionDigits: 2 })}
          </p>
        </div>
      </div>

      {rows.length === 0 ? (
        <Card>
          <EmptyState
            title="No account statements"
            description="Monthly billing statements (EECC) synced from Airtable will appear here."
          />
        </Card>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full" aria-label="Account statements list">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Tenant</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden sm:table-cell">Period</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Total Due (S/)</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden md:table-cell">Rent</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden lg:table-cell">Due Date</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Send Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((stmt) => {
                const contract = stmt.contracts as { tenants: { full_name: string } | null } | null;
                const tenantName = contract?.tenants?.full_name ?? '—';
                const period = stmt.mes && stmt.anio ? `${stmt.mes} ${stmt.anio}` : '—';
                const statusLabel = SEND_STATUS_LABEL[stmt.send_status ?? ''] ?? (stmt.send_status ?? '—');
                return (
                  <tr key={stmt.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-5 py-4 text-sm font-medium text-slate-900">{tenantName}</td>
                    <td className="px-5 py-4 text-sm text-slate-500 hidden sm:table-cell">{period}</td>
                    <td className="px-5 py-4 text-sm font-semibold text-slate-900">
                      S/ {(stmt.total_due ?? 0).toLocaleString('es-PE', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="px-5 py-4 text-sm text-slate-500 hidden md:table-cell">
                      S/ {(stmt.rent_amount ?? 0).toLocaleString('es-PE', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="px-5 py-4 text-sm text-slate-500 hidden lg:table-cell">{stmt.due_date ?? '—'}</td>
                    <td className="px-5 py-4">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${statusClass(stmt.send_status)}`}>
                        {statusLabel}
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
