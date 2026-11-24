import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { countExpiringDocuments } from '@/lib/document-expirations/queries';
import { limaToday } from '@/lib/document-expirations/status';

export async function ExpiringDocumentsBanner({ orgId }: { orgId: string }) {
  const { expired, soon } = await countExpiringDocuments(orgId, limaToday());
  if (expired + soon === 0) return null;
  const t = await getTranslations('expiringDocumentsBanner');

  return (
    <div role="status" className="rounded-lg border border-amber-300 bg-amber-50 px-5 py-3 text-sm text-amber-900 flex flex-wrap items-center justify-between gap-2">
      <p>{t('summary', { expired, soon })}</p>
      <Link href="/dashboard/expirations" className="font-medium underline">{t('review')}</Link>
    </div>
  );
}
