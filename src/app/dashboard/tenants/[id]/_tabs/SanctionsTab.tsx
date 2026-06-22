import { requireAdmin } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { sanctions } from '@/lib/db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';

interface Props {
  tenantId: string;
}

/**
 * Async Server Component — self-fetches sanctions for the given tenant.
 * Wrapped in <Suspense fallback={<TabFallback />}> by the parent page so it
 * streams independently without blocking the page shell.
 */
export async function SanctionsTab({ tenantId }: Props) {
  let ctx;
  try { ctx = await requireAdmin(); } catch { redirect('/login'); }

  const [rows, t] = await Promise.all([
    db
      .select({
        id:        sanctions.id,
        kind:      sanctions.kind,
        title:     sanctions.title,
        reason:    sanctions.reason,
        amount:    sanctions.amount,
        status:    sanctions.status,
        createdAt: sanctions.createdAt,
      })
      .from(sanctions)
      .where(and(eq(sanctions.tenantId, tenantId), eq(sanctions.orgId, ctx.orgId)))
      .orderBy(desc(sanctions.createdAt))
      .limit(50),
    getTranslations('tenantTabs.sanctionsTab'),
  ]);

  return (
    <div className="p-4">
      <Card>
        <CardHeader><CardTitle>{t('title')}</CardTitle></CardHeader>
        {rows.length === 0 ? (
          <p className="text-sm text-slate-400">{t('emptyState')}</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {rows.map((s) => (
              <div key={s.id} className="py-3 flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-medium text-slate-900">{s.title}</p>
                    <Badge variant={s.kind === 'monetary' ? 'danger' : 'warning'}>
                      {s.kind}
                    </Badge>
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">{s.reason}</p>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {s.createdAt ? new Date(s.createdAt).toLocaleDateString() : '—'}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {s.amount && (
                    <span className="text-sm font-medium text-slate-900">
                      S/ {Number(s.amount).toLocaleString('es-PE', { minimumFractionDigits: 2 })}
                    </span>
                  )}
                  <Badge
                    variant={
                      s.status === 'approved' ? 'danger' :
                      s.status === 'disputed' ? 'warning' :
                      s.status === 'resolved' ? 'success' :
                      'default'
                    }
                  >
                    {s.status}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
