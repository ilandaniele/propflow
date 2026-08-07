import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { requireAdmin } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { accountStatements, contracts, tenants } from '@/lib/db/schema';
import { eq, desc, and } from 'drizzle-orm';
import { computeStatementKpis } from '@/lib/finance/statement-kpis';
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

  const t = await getTranslations('accountStatements');

  const rows = await db
    .select({
      id:                  accountStatements.id,
      contractId:          accountStatements.contractId,
      mes:                 accountStatements.mes,
      anio:                accountStatements.anio,
      dueDate:             accountStatements.dueDate,
      rentAmount:          accountStatements.rentAmount,
      additionalSubtotal:  accountStatements.additionalSubtotal,
      totalDue:            accountStatements.totalDue,
      sendStatus:          accountStatements.sendStatus,
      whatsappMessageId:   accountStatements.whatsappMessageId,
      sendError:           accountStatements.sendError,
      tenantFullName:      tenants.fullName,
    })
    .from(accountStatements)
    .leftJoin(contracts, and(eq(contracts.id, accountStatements.contractId), eq(contracts.orgId, ctx.orgId)))
    .leftJoin(tenants, and(eq(tenants.id, contracts.tenantId), eq(tenants.orgId, ctx.orgId)))
    .where(eq(accountStatements.orgId, ctx.orgId))
    .orderBy(desc(accountStatements.anio), desc(accountStatements.mes));
  // No .limit(): KPI totals (total due, sent count, billing composition) must
  // cover every statement. Table render is sliced to 200 for DOM size.

  // Analytics — over ALL statements (rows is uncapped; table render is sliced).
  const today = new Date().toISOString().slice(0, 10);
  const {
    sentCount, errorCount, totalDue, totalRent, totalAddl,
    additionalsPct, withWhatsapp, withError, overdue, dueToday,
  } = computeStatementKpis(rows, today);

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

          {/* Billing composition */}
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
                    {overdue.slice(0, 5).map((r) => (
                      <li key={r.id} className="text-xs text-red-700">
                        {r.tenantFullName ?? '—'} — {r.mes} {r.anio} ({t('kpi.dueOn')} {r.dueDate})
                      </li>
                    ))}
                    {overdue.length > 5 && <li className="text-xs text-red-400">+{overdue.length - 5} {t('kpi.more')}</li>}
                  </ul>
                </div>
              )}
              {dueToday.length > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl px-5 py-4">
                  <p className="text-sm font-semibold text-amber-800 mb-1">{t('kpi.dueTodayAlert', { count: dueToday.length })}</p>
                  <ul className="space-y-0.5">
                    {dueToday.slice(0, 5).map((r) => (
                      <li key={r.id} className="text-xs text-amber-700">
                        {r.tenantFullName ?? '—'} — {r.mes} {r.anio}
                      </li>
                    ))}
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
              {rows.slice(0, 200).map((stmt) => {
                const period = stmt.mes && stmt.anio ? `${stmt.mes} ${stmt.anio}` : '—';
                const isOverdue = stmt.dueDate && stmt.dueDate < today && stmt.sendStatus !== 'sent';
                const statusLabel = stmt.sendStatus ? stmt.sendStatus.charAt(0).toUpperCase() + stmt.sendStatus.slice(1) : '—';
                return (
                  <tr key={stmt.id} className={`transition-colors ${isOverdue ? 'bg-red-50 hover:bg-red-100' : 'hover:bg-slate-50'}`}>
                    <td className="px-5 py-4 text-sm font-medium text-slate-900">{stmt.tenantFullName ?? '—'}</td>
                    <td className="px-5 py-4 text-sm text-slate-500 hidden sm:table-cell">{period}</td>
                    <td className="px-5 py-4 text-sm font-semibold text-slate-900">
                      S/ {Number(stmt.totalDue ?? 0).toLocaleString('es-PE', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="px-5 py-4 text-sm text-slate-500 hidden md:table-cell">
                      S/ {Number(stmt.rentAmount ?? 0).toLocaleString('es-PE', { minimumFractionDigits: 2 })}
                    </td>
                    <td className={`px-5 py-4 text-sm hidden lg:table-cell ${isOverdue ? 'text-red-600 font-medium' : 'text-slate-500'}`}>
                      {stmt.dueDate ?? '—'}
                    </td>
                    <td className="px-5 py-4">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${statusClass(stmt.sendStatus)}`}>
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
