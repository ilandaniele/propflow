import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { requireAdmin } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { sanctions, tenants } from '@/lib/db/schema';
import { eq, desc } from 'drizzle-orm';
import { getTranslations } from 'next-intl/server';
import { Badge } from '@/components/ui/Badge';

export const metadata: Metadata = { title: 'Sanctions' };

export default async function SanctionsPage() {
  let ctx;
  try { ctx = await requireAdmin(); } catch { redirect('/login'); }

  const t = await getTranslations('sanctions');

  const rows = await db
    .select({
      id:        sanctions.id,
      kind:      sanctions.kind,
      title:     sanctions.title,
      reason:    sanctions.reason,
      amount:    sanctions.amount,
      status:    sanctions.status,
      createdAt: sanctions.createdAt,
      tenantId:  sanctions.tenantId,
      tenantFullName: tenants.fullName,
    })
    .from(sanctions)
    .leftJoin(tenants, eq(tenants.id, sanctions.tenantId))
    .where(eq(sanctions.orgId, ctx.orgId))
    .orderBy(desc(sanctions.createdAt))
    .limit(50);

  const kindVariant = (kind: string) => kind === 'monetary' ? 'danger' : 'warning';
  const statusVariant = (status: string) => {
    if (status === 'approved') return 'danger';
    if (status === 'disputed') return 'warning';
    if (status === 'resolved') return 'success';
    if (status === 'rejected') return 'default';
    return 'info';
  };

  return (
    <div className="max-w-4xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-900">{t('title')}</h1>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
        {rows.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-400">{t('noSanctions')}</div>
        ) : (
          rows.map((s) => (
            <div key={s.id} className="px-4 py-3 flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm font-medium text-slate-900">{s.title}</p>
                  <Badge variant={kindVariant(s.kind)}>{s.kind}</Badge>
                </div>
                <p className="text-xs text-slate-500 mt-0.5">{s.reason}</p>
                <p className="text-xs text-slate-400 mt-0.5">
                  <Link href={`/dashboard/tenants/${s.tenantId}`} className="text-brand-600 hover:underline">
                    {s.tenantFullName ?? 'Unknown'}
                  </Link>
                  {' '}· {new Date(s.createdAt).toLocaleDateString()}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {s.amount && <span className="text-sm font-medium">S/ {Number(s.amount).toLocaleString('es-PE', { minimumFractionDigits: 2 })}</span>}
                <Badge variant={statusVariant(s.status)}>{s.status}</Badge>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
