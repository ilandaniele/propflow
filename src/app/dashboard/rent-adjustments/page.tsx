import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { and, desc, eq, max } from 'drizzle-orm';
import { getTranslations } from 'next-intl/server';
import { requireAdmin } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { contracts, rentAdjustments, tenants, units } from '@/lib/db/schema';
import { isAdjustmentDue, isoDaysFrom, nextAnniversary } from '@/lib/finance/rent-adjustment-math';
import { formatMoney } from '@/lib/finance/format-money';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { RentAdjustmentForm } from './RentAdjustmentForm';

export const metadata: Metadata = { title: 'Rent adjustments' };

const DUE_WINDOW_DAYS = 30;

export default async function RentAdjustmentsPage() {
  let ctx;
  try { ctx = await requireAdmin(); } catch { redirect('/login'); }
  const t = await getTranslations('rentAdjustments');

  const [contractRows, history] = await Promise.all([
    db
      .select({
        id: contracts.id,
        startDate: contracts.startDate,
        monthlyRent: contracts.monthlyRent,
        tenantName: tenants.fullName,
        unitLabel: units.label,
        lastAdjustedOn: max(rentAdjustments.effectiveOn),
      })
      .from(contracts)
      .leftJoin(tenants, and(eq(tenants.id, contracts.tenantId), eq(tenants.orgId, ctx.orgId)))
      .leftJoin(units, and(eq(units.id, contracts.unitId), eq(units.orgId, ctx.orgId)))
      .leftJoin(rentAdjustments, and(eq(rentAdjustments.contractId, contracts.id), eq(rentAdjustments.orgId, ctx.orgId)))
      .where(and(eq(contracts.orgId, ctx.orgId), eq(contracts.status, 'active')))
      .groupBy(contracts.id)
      .limit(500),
    db
      .select({
        id: rentAdjustments.id,
        effectiveOn: rentAdjustments.effectiveOn,
        previousRent: rentAdjustments.previousRent,
        newRent: rentAdjustments.newRent,
        percent: rentAdjustments.percent,
        tenantName: tenants.fullName,
      })
      .from(rentAdjustments)
      .innerJoin(contracts, and(eq(contracts.id, rentAdjustments.contractId), eq(contracts.orgId, ctx.orgId)))
      .leftJoin(tenants, and(eq(tenants.id, contracts.tenantId), eq(tenants.orgId, ctx.orgId)))
      .where(eq(rentAdjustments.orgId, ctx.orgId))
      .orderBy(desc(rentAdjustments.effectiveOn), desc(rentAdjustments.createdAt))
      .limit(50),
  ]);

  const now = new Date();
  const today = isoDaysFrom(now, 0);
  const horizon = isoDaysFrom(now, DUE_WINDOW_DAYS);
  const rows = contractRows
    .map((row) => {
      const anniversary = nextAnniversary(row.startDate, today);
      return { ...row, anniversary, due: isAdjustmentDue(anniversary, row.lastAdjustedOn, horizon) };
    })
    .sort((a, b) => a.anniversary.localeCompare(b.anniversary));
  const dueCount = rows.filter((row) => row.due).length;

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">{t('title')}</h1>
        <p className="text-sm text-slate-500 mt-1">{t('subtitle', { days: DUE_WINDOW_DAYS })}</p>
      </div>

      {dueCount > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-5 py-3 text-sm font-semibold text-amber-800">
          {t('dueAlert', { count: dueCount })}
        </div>
      )}

      {rows.length === 0 ? (
        <Card><EmptyState title={t('emptyTitle')} description={t('emptyDesc')} /></Card>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
          <table className="w-full text-sm" aria-label={t('title')}>
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                <th className="text-left px-4 py-3">{t('colTenant')}</th>
                <th className="text-right px-4 py-3">{t('colRent')}</th>
                <th className="text-left px-4 py-3 hidden md:table-cell">{t('colAnniversary')}</th>
                <th className="text-left px-4 py-3 hidden md:table-cell">{t('colLast')}</th>
                <th className="text-left px-4 py-3">{t('colApply')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((row) => (
                <tr key={row.id} className={row.due ? 'bg-amber-50' : undefined}>
                  <td className="px-4 py-3">
                    <span className="font-medium text-slate-900">{row.tenantName ?? '—'}</span>
                    <span className="block text-xs text-slate-400">{row.unitLabel ?? '—'}</span>
                  </td>
                  <td className="px-4 py-3 text-right font-semibold">{formatMoney(Number(row.monthlyRent))}</td>
                  <td className="px-4 py-3 hidden md:table-cell">
                    <span className={row.due ? 'font-medium text-amber-700' : 'text-slate-500'}>{row.anniversary}</span>
                  </td>
                  <td className="px-4 py-3 text-slate-500 hidden md:table-cell">{row.lastAdjustedOn ?? '—'}</td>
                  <td className="px-4 py-3">
                    <RentAdjustmentForm contractId={row.id} monthlyRent={Number(row.monthlyRent)} defaultDate={row.anniversary} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {history.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
          <h2 className="px-4 pt-4 text-sm font-semibold text-slate-700">{t('historyTitle')}</h2>
          <table className="w-full text-sm mt-2" aria-label={t('historyTitle')}>
            <tbody className="divide-y divide-slate-100">
              {history.map((h) => (
                <tr key={h.id}>
                  <td className="px-4 py-2 text-slate-500">{h.effectiveOn}</td>
                  <td className="px-4 py-2">{h.tenantName ?? '—'}</td>
                  <td className="px-4 py-2 text-right text-slate-500">{formatMoney(Number(h.previousRent))}</td>
                  <td className="px-4 py-2 text-right font-medium">{formatMoney(Number(h.newRent))}</td>
                  <td className="px-4 py-2 text-right text-slate-500">{Number(h.percent) > 0 ? '+' : ''}{Number(h.percent)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
