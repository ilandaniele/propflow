import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { requireAdmin } from '@/lib/auth/guards';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { ExpiringDocumentForm } from '@/components/document-expirations/ExpiringDocumentForm';
import { RemoveExpiringDocumentButton } from '@/components/document-expirations/RemoveExpiringDocumentButton';
import { listExpiringDocuments, listSubjectOptions } from '@/lib/document-expirations/queries';
import { expiryStatus, limaToday, type ExpiryStatus } from '@/lib/document-expirations/status';

export const metadata: Metadata = { title: 'Expirations' };

const STATUS_VARIANT: Record<ExpiryStatus, 'danger' | 'warning' | 'success'> = {
  expired: 'danger',
  soon: 'warning',
  ok: 'success',
};

export default async function ExpirationsPage() {
  let ctx;
  try { ctx = await requireAdmin(); } catch { redirect('/login'); }

  const [t, rows, options] = await Promise.all([
    getTranslations('documentExpirations'),
    listExpiringDocuments(ctx.orgId),
    listSubjectOptions(ctx.orgId),
  ]);
  const today = limaToday();

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">{t('title')}</h1>
        <p className="text-sm text-slate-500 mt-1">{t('subtitle')}</p>
      </div>

      <Card padding="md">
        <h2 className="text-base font-medium text-slate-800 mb-4">{t('addTitle')}</h2>
        <ExpiringDocumentForm tenants={options.tenants} properties={options.properties} />
      </Card>

      <Card padding="md">
        {rows.length === 0 ? (
          <p className="text-sm text-slate-500">{t('empty')}</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {rows.map((row) => {
              const status = expiryStatus(row.expiresOn, today);
              return (
                <li key={row.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
                  <div>
                    <p className="font-medium text-slate-900">{t(`kinds.${row.kind}`)} · {row.label}</p>
                    <p className="text-slate-500">
                      {t('expires', { date: row.expiresOn })}
                      {row.tenantName && ` · ${row.tenantName}`}
                      {row.propertyName && ` · ${row.propertyName}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge variant={STATUS_VARIANT[status]}>{t(`status.${status}`)}</Badge>
                    <RemoveExpiringDocumentButton id={row.id} />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
