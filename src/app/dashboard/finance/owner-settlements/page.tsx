import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { requireAdmin } from '@/lib/auth/guards';
import { SettlementQuerySchema } from '@/lib/schemas/owner-settlement';
import { ownerSettlements, ownerTermsOverview } from '@/lib/finance/owner-settlement-query';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { OwnerTermsForm } from './OwnerTermsForm';
import { PrintButton } from './PrintButton';
import { OwnerSettlementCard } from '@/components/finance/OwnerSettlementCard';
import { shiftMonth } from '@/lib/finance/month';
import { listOwnerPortalLinks } from '@/lib/owner-portal/queries';
import { OwnerPortalLinks } from './OwnerPortalLinks';

export const metadata: Metadata = { title: 'Owner settlements' };

export default async function OwnerSettlementsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  let ctx;
  try { ctx = await requireAdmin(); } catch { redirect('/login'); }

  const parsed = SettlementQuerySchema.safeParse(await searchParams);
  const { month, owner_id: ownerId } = parsed.success ? parsed.data : SettlementQuerySchema.parse({});
  const [settlements, overview, portalLinks, t] = await Promise.all([
    ownerSettlements(ctx.orgId, { month, ownerId }),
    ownerTermsOverview(ctx.orgId),
    listOwnerPortalLinks(ctx.orgId),
    getTranslations('ownerSettlements'),
  ]);

  const query = (nextMonth: string) => `?month=${nextMonth}${ownerId ? `&owner_id=${encodeURIComponent(ownerId)}` : ''}`;
  const exportHref = `/api/admin/reports/owner-settlement${query(month)}`;

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{t('title')}</h1>
          <p className="text-sm text-slate-500 mt-1">{t('subtitle', { month })}</p>
        </div>
        <div className="flex gap-2 print:hidden">
          <PrintButton label={t('print')} />
          <a href={exportHref} className="inline-flex items-center rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700">
            {t('exportCsv')}
          </a>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-4 print:hidden">
        <nav aria-label={t('monthNav')} className="flex items-center gap-3 text-sm">
          <Link href={query(shiftMonth(month, -1))} className="text-slate-600 underline">{shiftMonth(month, -1)}</Link>
          <span className="font-semibold text-slate-900 tabular-nums">{month}</span>
          <Link href={query(shiftMonth(month, 1))} className="text-slate-600 underline">{shiftMonth(month, 1)}</Link>
        </nav>
        <form method="get" className="flex items-center gap-2 text-sm">
          <input type="hidden" name="month" value={month} />
          <label htmlFor="settlement-owner" className="text-slate-600">{t('owner')}</label>
          <select id="settlement-owner" name="owner_id" defaultValue={ownerId ?? ''} className="rounded-lg border border-slate-300 px-2 py-1.5">
            <option value="">{t('allOwners')}</option>
            {overview.ownerOptions.map((option) => <option key={option.id} value={option.id}>{option.name ?? option.id}</option>)}
          </select>
          <button type="submit" className="rounded-lg border border-slate-300 px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-50">{t('apply')}</button>
        </form>
      </div>

      {settlements.length === 0 ? (
        <Card><EmptyState title={t('emptyTitle')} description={t('emptyDesc')} /></Card>
      ) : (
        settlements.map((settlement) => <OwnerSettlementCard key={settlement.ownerId} settlement={settlement} />)
      )}

      <Card className="print:hidden">
        <h2 className="text-lg font-semibold text-slate-900">{t('termsTitle')}</h2>
        <p className="text-sm text-slate-500 mb-4">{t('termsDesc')}</p>
        {overview.ownerOptions.length === 0 || overview.propertyOptions.length === 0 ? (
          <p className="text-sm text-slate-500">{t('termsMissingData')}</p>
        ) : (
          <OwnerTermsForm properties={overview.propertyOptions} owners={overview.ownerOptions} />
        )}
        {overview.terms.length > 0 && (
          <ul className="mt-4 divide-y divide-slate-100 text-sm">
            {overview.terms.map((term) => (
              <li key={term.propertyId} className="flex justify-between py-2">
                <span className="text-slate-900">{term.propertyName}</span>
                <span className="text-slate-600">{term.ownerName ?? t('unnamedOwner')} · {Number(term.commissionPct)}%</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card className="print:hidden">
        <OwnerPortalLinks owners={overview.ownerOptions} links={portalLinks} />
      </Card>
      <p className="text-xs text-slate-500">{t('expensesNote')}</p>
    </div>
  );
}
