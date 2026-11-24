import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { requireAdmin } from '@/lib/auth/guards';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { listLinkableCharges, listPaymentIntents } from '@/lib/online-payments/queries';
import { formatAmount, isIntentPayable } from '@/lib/online-payments/format';
import { payLinkPath } from '@/lib/online-payments/token';
import { CreatePaymentLinkForm } from './CreatePaymentLinkForm';

export const metadata: Metadata = { title: 'Online Payments' };

const STATUS_VARIANT = { paid: 'success', pending: 'pending', expired: 'default', failed: 'danger' } as const;

interface Props {
  searchParams: Promise<{ cursor?: string }>;
}

export default async function OnlinePaymentsPage({ searchParams }: Props) {
  let ctx;
  try { ctx = await requireAdmin(); } catch { redirect('/login'); }

  const t = await getTranslations('onlinePayments');
  const { cursor } = await searchParams;
  const [{ items, nextCursor }, linkable] = await Promise.all([
    listPaymentIntents(ctx.orgId, cursor),
    listLinkableCharges(ctx.orgId),
  ]);
  const chargeOptions = linkable.map((c) => ({
    id: c.id,
    label: `${c.tenantName ?? t('unknownTenant')} — ${c.description ?? t('defaultConcept')} — ${formatAmount(c.amount, 'PEN')}${c.dueDate ? ` (${c.dueDate})` : ''}`,
  }));
  const now = new Date();

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">{t('title')}</h1>
        <p className="text-sm text-slate-500 mt-1">{t('subtitle')}</p>
      </div>

      <Card>
        <div className="p-5 space-y-3">
          <h2 className="text-sm font-semibold text-slate-700">{t('createTitle')}</h2>
          <CreatePaymentLinkForm charges={chargeOptions} />
        </div>
      </Card>

      {items.length === 0 ? (
        <EmptyState title={t('emptyTitle')} description={t('emptyDescription')} />
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-slate-500 border-b border-slate-100">
                <tr>
                  <th className="px-4 py-3 font-medium">{t('colTenant')}</th>
                  <th className="px-4 py-3 font-medium">{t('colConcept')}</th>
                  <th className="px-4 py-3 font-medium">{t('colAmount')}</th>
                  <th className="px-4 py-3 font-medium">{t('colStatus')}</th>
                  <th className="px-4 py-3 font-medium">{t('colPaid')}</th>
                  <th className="px-4 py-3 font-medium">{t('colLink')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((intent) => (
                  <tr key={intent.id}>
                    <td className="px-4 py-3 text-slate-700">{intent.tenantName ?? t('unknownTenant')}</td>
                    <td className="px-4 py-3 text-slate-700">{intent.concept ?? t('defaultConcept')}</td>
                    <td className="px-4 py-3 text-slate-900 font-medium">{formatAmount(intent.amount, intent.currency)}</td>
                    <td className="px-4 py-3">
                      <Badge variant={STATUS_VARIANT[intent.status]}>{t(`status.${intent.status}`)}</Badge>
                      <span className="block text-xs text-slate-400 mt-1">{t(`provider.${intent.provider}`)}</span>
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {intent.paidAt && intent.amountPaid
                        ? `${formatAmount(intent.amountPaid, intent.currency)} · ${intent.paidAt.toLocaleDateString('es-PE')}`
                        : '—'}
                    </td>
                    <td className="px-4 py-3">
                      {isIntentPayable(intent, now)
                        ? <a href={payLinkPath(intent.token)} target="_blank" rel="noopener noreferrer" className="text-brand-600 hover:underline">{t('openLink')}</a>
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {nextCursor && (
        <div className="flex justify-end">
          <Link href={`/dashboard/online-payments?cursor=${encodeURIComponent(nextCursor)}`} className="text-sm text-brand-600 hover:underline">
            {t('next')}
          </Link>
        </div>
      )}
    </div>
  );
}
