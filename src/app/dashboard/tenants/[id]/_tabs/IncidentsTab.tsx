import { requireAdmin } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { incidents } from '@/lib/db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { StatusPill, PriorityPill } from '@/components/ui/Badge';
import Link from 'next/link';

interface Props {
  tenantId: string;
}

/**
 * Async Server Component — self-fetches incidents for the given tenant.
 * Wrapped in <Suspense fallback={<TabFallback />}> by the parent page so it
 * streams independently without blocking the page shell.
 */
export async function IncidentsTab({ tenantId }: Props) {
  let ctx;
  try { ctx = await requireAdmin(); } catch { redirect('/login'); }

  const [rows, t] = await Promise.all([
    db
      .select({
        id:        incidents.id,
        title:     incidents.title,
        category:  incidents.category,
        priority:  incidents.priority,
        status:    incidents.status,
        createdAt: incidents.createdAt,
      })
      .from(incidents)
      .where(and(eq(incidents.tenantId, tenantId), eq(incidents.orgId, ctx.orgId)))
      .orderBy(desc(incidents.createdAt))
      .limit(50),
    getTranslations('tenantTabs.incidentsTab'),
  ]);

  return (
    <div className="p-4">
      <Card>
        <CardHeader><CardTitle>{t('title')}</CardTitle></CardHeader>
        {rows.length === 0 ? (
          <p className="text-sm text-slate-400">{t('emptyState')}</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {rows.map((i) => (
              <div key={i.id} className="py-3 flex items-center justify-between">
                <div>
                  <Link
                    href={`/dashboard/incidents/${i.id}`}
                    className="text-sm font-medium text-slate-900 hover:text-brand-600 transition-colors"
                  >
                    {i.title}
                  </Link>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {i.category} · {i.createdAt ? new Date(i.createdAt).toLocaleDateString() : '—'}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <PriorityPill priority={i.priority} />
                  <StatusPill status={i.status} />
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
