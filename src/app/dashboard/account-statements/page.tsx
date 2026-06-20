import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/auth/guards';
import { getTranslations } from 'next-intl/server';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';

export const metadata: Metadata = { title: 'Account Statements' };

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

  const [supabase, t] = await Promise.all([createClient(), getTranslations('accountStatements')]);

  const { data: statements } = await supabase
    .from('account_statements')
    .select('*, contracts(id, tenants(full_name))')
    .eq('org_id', ctx.orgId)
    .order('anio', { ascending: false })
    .order('mes', { ascending: false })
    .limit(200);

  const rows = statements ?? [];

  // Analytics
  const today = new Date().toISOString().slice(0, 10);
  const sentCount    = rows.filter((r) => r.send_status === 'sent').length;
  const pendingCount = rows.filter((r) => r.send_status === 'pending').length;
  const errorCount   = rows.filter((r) => r.send_status === 'error').length;
  const totalDue     = rows.reduce((s, r) => s + (r.total_due ?? 0), 0);
  const totalRent    = rows.reduce((s, r) => s + (r.rent_amount ?? 0), 0);
  const totalAddl    = rows.reduce((s, r) => s + (r.additional_subtotal ?? 0), 0);

  // Aging: overdue = due_date < today AND send_status != 'sent'
  const overdue  = rows.filter((r) => r.due_date && r.due_date < today && r.send_status !== 'sent');
  const dueToday = rows.filter((r) => r.due_date === today);
  const upcoming = rows.filter((r) => r.due_date && r.due_date > today && r.send_status !== 'sent');

  // Breakdown: rent vs. additionals as % of total
  const additionalsPct = totalDue > 0 ? Math.round((totalAddl / totalDue) * 100) : 0;

  // WhatsApp stats
  const withWhatsapp = rows.filter((r) => r.whatsapp_message_id).length;
  const withError    = rows.filter((r) => r.send_error).length;

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">{t('title')}</h1>
        <p className="text-sm text-slate-500 mt-1">
          {t('subtitle', { count: rows.length, sent: sentCount, total: totalDue.toLocaleString('es-PE', { minimumFractionDigits: 2 }) })}
        </p>
      </div>

      {rows.length > 0 && (
        <>
          {/* KPI tiles */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">{t('kpi.totalDue')}</p>
              <p className="text-xl font-bold text-slate-900">S/ {totalDue.toLocaleString('es-PE', { minimumFractionDigits: 2 })}</p>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">{t('kpi.sent')}</p>
              <p className="text-xl font-bold text-green-600">{sentCount}</p>
              {errorCount > 0 && <p className="text-xs text-red-500 mt-0.5">{errorCount} {t('kpi.errors')}</p>}
            </div>
            <div className={`rounded-xl border p-4 ${overdue.length > 0 ? 'bg-red-50 border-red-300' : 'bg-white border-slate-200'}`}>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">{t('kpi.overdue')}</p>
              <p className={`text-xl font-bold ${overdue.length > 0 ? 'text-red-600' : 'text-slate-900'}`}>{overdue.length}</p>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">{t('kpi.whatsapp')}</p>
              <p className="text-xl font-bold text-slate-900">{withWhatsapp}</p>
              {withError > 0 && <p className="text-xs text-red-500 mt-0.5">{withError} {t('kpi.sendErrors')}</p>}
            </div>
          </div>

          {/* Billing composition: rent vs. additionals */}
          <div className="bg-white rounded-xl border border-slate-200 p-5">
            <h2 className="text-sm font-semibold text-slate-700 mb-3">{t('kpi.composition')}</h2>
            <div className="flex items-center gap-3 mb-2">
              <div className="flex-1 bg-slate-100 rounded-full h-3 overflow-hidden">
                <div className="h-3 bg-brand-500 rounded-l-full" style={{ width: `${100 - additionalsPct}%` }} />
              </div>
            </div>
            <div className="flex gap-6 text-xs text-slate-500">
              <span><span className="inline-block w-2 h-2 rounded-full bg-brand-500 mr-1" />{t('kpi.rent')}: S/ {totalRent.toLocaleString('es-PE', { minimumFractionDigits: 2 })} ({100 - additionalsPct}%)</span>
              <span><span className="inline-block w-2 h-2 rounded-full bg-slate-300 mr-1" />{t('kpi.additionals')}: S/ {totalAddl.toLocaleString('es-PE', { minimumFractionDigits: 2 })} ({additionalsPct}%)</span>
            </div>
          </div>

          {/* Aging alerts */}
          {(overdue.length > 0 || dueToday.length > 0) && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {overdue.length > 0 && (
                <div className="bg-red-50 border border-red-200 rounded-xl px-5 py-4">
                  <p className="text-sm font-semibold text-red-800 mb-1">{t('kpi.overdueAlert', { count: overdue.length })}</p>
                  <ul className="space-y-0.5">
                    {overdue.slice(0, 5).map((r) => {
                      const contract = r.contracts as { tenants: { full_name: string } | null } | null;
                      return (
                        <li key={r.id} className="text-xs text-red-700">
                          {contract?.tenants?.full_name ?? '—'} — {r.mes} {r.anio} ({t('kpi.dueOn')} {r.due_date})
                        </li>
                      );
                    })}
                    {overdue.length > 5 && <li className="text-xs text-red-400">+{overdue.length - 5} {t('kpi.more')}</li>}
                  </ul>
                </div>
              )}
              {dueToday.length > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl px-5 py-4">
                  <p className="text-sm font-semibold text-amber-800 mb-1">{t('kpi.dueTodayAlert', { count: dueToday.length })}</p>
                  <ul className="space-y-0.5">
                    {dueToday.slice(0, 5).map((r) => {
                      const contract = r.contracts as { tenants: { full_name: string } | null } | null;
                      return (
                        <li key={r.id} className="text-xs text-amber-700">
                          {contract?.tenants?.full_name ?? '—'} — {r.mes} {r.anio}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {rows.length === 0 ? (
        <Card>
          <EmptyState title={t('emptyTitle')} description={t('emptyDesc')} />
        </Card>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full" aria-label={t('title')}>
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">{t('colTenant')}</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden sm:table-cell">{t('colPeriod')}</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">{t('colTotalDue')}</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden md:table-cell">{t('colRent')}</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden lg:table-cell">{t('colDueDate')}</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">{t('colSendStatus')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((stmt) => {
                const contract = stmt.contracts as { tenants: { full_name: string } | null } | null;
                const tenantName = contract?.tenants?.full_name ?? '—';
                const period = stmt.mes && stmt.anio ? `${stmt.mes} ${stmt.anio}` : '—';
                const isOverdue = stmt.due_date && stmt.due_date < today && stmt.send_status !== 'sent';
                const statusLabel = stmt.send_status ? stmt.send_status.charAt(0).toUpperCase() + stmt.send_status.slice(1) : '—';
                return (
                  <tr key={stmt.id} className={`transition-colors ${isOverdue ? 'bg-red-50 hover:bg-red-100' : 'hover:bg-slate-50'}`}>
                    <td className="px-5 py-4 text-sm font-medium text-slate-900">{tenantName}</td>
                    <td className="px-5 py-4 text-sm text-slate-500 hidden sm:table-cell">{period}</td>
                    <td className="px-5 py-4 text-sm font-semibold text-slate-900">
                      S/ {(stmt.total_due ?? 0).toLocaleString('es-PE', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="px-5 py-4 text-sm text-slate-500 hidden md:table-cell">
                      S/ {(stmt.rent_amount ?? 0).toLocaleString('es-PE', { minimumFractionDigits: 2 })}
                    </td>
                    <td className={`px-5 py-4 text-sm hidden lg:table-cell ${isOverdue ? 'text-red-600 font-medium' : 'text-slate-500'}`}>
                      {stmt.due_date ?? '—'}
                    </td>
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
