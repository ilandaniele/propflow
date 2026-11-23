import type { Metadata } from 'next';
import Link from 'next/link';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { clientIpFromHeaders, ownerPortalRateLimit } from '@/lib/ratelimit';
import { SettlementQuerySchema } from '@/lib/schemas/owner-settlement';
import { resolveOwnerPortalLink } from '@/lib/owner-portal/queries';
import { ownerSettlements } from '@/lib/finance/owner-settlement-query';
import { shiftMonth } from '@/lib/finance/month';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { OwnerSettlementCard } from '@/components/finance/OwnerSettlementCard';

export const metadata: Metadata = {
  title: 'Owner portal',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

type Props = {
  params: Promise<{ token: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
};

export default async function OwnerPortalPage({ params, searchParams }: Props) {
  const t = await getTranslations('ownerPortal');
  if (!ownerPortalRateLimit(clientIpFromHeaders(await headers())).success) {
    return <main className="mx-auto max-w-xl p-6 text-sm text-slate-600">{t('rateLimited')}</main>;
  }

  const { token } = await params;
  const link = await resolveOwnerPortalLink(token);
  if (!link) notFound();

  const parsed = SettlementQuerySchema.safeParse(await searchParams);
  const { month } = parsed.success ? parsed.data : SettlementQuerySchema.parse({});
  const [settlement] = await ownerSettlements(link.orgId, { month, ownerId: link.ownerId });

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">{t('title', { name: link.ownerName ?? '' })}</h1>
        <p className="mt-1 text-sm text-slate-500">{t('subtitle', { month })}</p>
      </div>
      <nav aria-label={t('monthNav')} className="flex items-center gap-3 text-sm">
        <Link href={`?month=${shiftMonth(month, -1)}`} className="text-slate-600 underline">{shiftMonth(month, -1)}</Link>
        <span className="font-semibold tabular-nums text-slate-900">{month}</span>
        <Link href={`?month=${shiftMonth(month, 1)}`} className="text-slate-600 underline">{shiftMonth(month, 1)}</Link>
      </nav>
      {settlement ? (
        <OwnerSettlementCard settlement={settlement} />
      ) : (
        <Card><EmptyState title={t('emptyTitle')} description={t('emptyDesc')} /></Card>
      )}
      <p className="text-xs text-slate-500">{t('readOnlyNote')}</p>
    </main>
  );
}
