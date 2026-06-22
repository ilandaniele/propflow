import { requireAdmin } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { contracts } from '@/lib/db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { StatusPill } from '@/components/ui/Badge';

interface Props {
  tenantId: string;
}

/**
 * Async Server Component — self-fetches contract data for the given tenant.
 * Wrapped in <Suspense fallback={<TabFallback />}> by the parent page so it
 * streams independently without blocking the page shell.
 */
export async function ContractsTab({ tenantId }: Props) {
  let ctx;
  try { ctx = await requireAdmin(); } catch { redirect('/login'); }

  const [rows, t] = await Promise.all([
    db
      .select({
        id:          contracts.id,
        monthlyRent: contracts.monthlyRent,
        startDate:   contracts.startDate,
        endDate:     contracts.endDate,
        status:      contracts.status,
        documentUrl: contracts.documentUrl,
      })
      .from(contracts)
      .where(and(eq(contracts.tenantId, tenantId), eq(contracts.orgId, ctx.orgId)))
      .orderBy(desc(contracts.createdAt)),
    getTranslations('tenantTabs.contractsTab'),
  ]);

  return (
    <div className="p-4">
      <Card>
        <CardHeader><CardTitle>{t('title')}</CardTitle></CardHeader>
        {rows.length === 0 ? (
          <p className="text-sm text-slate-400">{t('emptyState')}</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {rows.map((c) => (
              <div key={c.id} className="py-4 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-slate-900">S/ {Number(c.monthlyRent).toLocaleString('es-PE', { minimumFractionDigits: 2 })}{t('perMonth')}</p>
                  <p className="text-xs text-slate-500">{c.startDate} → {c.endDate ?? '—'}</p>
                </div>
                <div className="flex items-center gap-3">
                  <StatusPill status={c.status} />
                  {c.documentUrl && (
                    <a
                      href={`/api/contracts/${c.id}/pdf`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-brand-600 hover:text-brand-800 underline"
                    >
                      {t('downloadPdf')}
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
