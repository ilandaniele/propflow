import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { and, desc, eq, sql } from 'drizzle-orm';
import { getTranslations } from 'next-intl/server';
import { requireAdmin } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { contracts, depositMovements, tenants, units } from '@/lib/db/schema';
import { depositTotalsColumns, heldDeposit } from '@/lib/finance/deposit';
import { formatMoney } from '@/lib/finance/format-money';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';

export const metadata: Metadata = { title: 'Deposits' };

export default async function DepositsPage() {
  let ctx;
  try { ctx = await requireAdmin(); } catch { redirect('/login'); }
  const t = await getTranslations('deposits');

  const rows = await db
    .select({
      id: contracts.id,
      status: contracts.status,
      agreed: contracts.deposit,
      tenantName: tenants.fullName,
      unitLabel: units.label,
      ...depositTotalsColumns,
    })
    .from(contracts)
    .leftJoin(tenants, and(eq(tenants.id, contracts.tenantId), eq(tenants.orgId, ctx.orgId)))
    .leftJoin(units, and(eq(units.id, contracts.unitId), eq(units.orgId, ctx.orgId)))
    .leftJoin(depositMovements, and(eq(depositMovements.contractId, contracts.id), eq(depositMovements.orgId, ctx.orgId)))
    .where(eq(contracts.orgId, ctx.orgId))
    .groupBy(contracts.id)
    .having(sql`COALESCE(CAST(${contracts.deposit} AS REAL), 0) > 0 OR COUNT(${depositMovements.id}) > 0`)
    .orderBy(desc(contracts.startDate))
    .limit(500);

  const totalHeld = rows.reduce((sum, row) => sum + heldDeposit(row), 0);

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">{t('title')}</h1>
        <p className="text-sm text-slate-500 mt-1">{t('subtitle', { total: formatMoney(totalHeld) })}</p>
      </div>
      {rows.length === 0 ? (
        <Card><EmptyState title={t('emptyTitle')} description={t('emptyDesc')} /></Card>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
          <table className="w-full text-sm" aria-label={t('title')}>
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                <th className="text-left px-4 py-3">{t('colTenant')}</th>
                <th className="text-right px-4 py-3">{t('colAgreed')}</th>
                <th className="text-right px-4 py-3">{t('colCollected')}</th>
                <th className="text-right px-4 py-3 hidden md:table-cell">{t('colDeducted')}</th>
                <th className="text-right px-4 py-3 hidden md:table-cell">{t('colRefunded')}</th>
                <th className="text-right px-4 py-3">{t('colHeld')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((row) => (
                <tr key={row.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <Link href={`/dashboard/deposits/${row.id}`} className="font-medium text-brand-700 hover:underline">{row.tenantName ?? '—'}</Link>
                    <span className="block text-xs text-slate-400">{row.unitLabel ?? '—'} · {row.status}</span>
                  </td>
                  <td className="px-4 py-3 text-right text-slate-500">{formatMoney(Number(row.agreed ?? 0))}</td>
                  <td className="px-4 py-3 text-right">{formatMoney(Number(row.collected))}</td>
                  <td className="px-4 py-3 text-right hidden md:table-cell">{formatMoney(Number(row.deducted))}</td>
                  <td className="px-4 py-3 text-right hidden md:table-cell">{formatMoney(Number(row.refunded))}</td>
                  <td className="px-4 py-3 text-right font-semibold">{formatMoney(heldDeposit(row))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
