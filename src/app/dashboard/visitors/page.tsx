import { requireAdmin } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { visitorLogs } from '@/lib/db/schema';
import { eq, desc } from 'drizzle-orm';
import { getTranslations } from 'next-intl/server';
import { EmptyState } from '@/components/ui/EmptyState';
import { Card } from '@/components/ui/Card';
import { CreateVisitorForm } from './CreateVisitorForm';

export default async function AdminVisitorsPage() {
  const ctx = await requireAdmin();
  const t = await getTranslations('visitors');

  const visitors = await db
    .select({
      id:          visitorLogs.id,
      visitorName: visitorLogs.visitorName,
      visitDate:   visitorLogs.visitDate,
      entryTime:   visitorLogs.entryTime,
      exitTime:    visitorLogs.exitTime,
      purpose:     visitorLogs.purpose,
      unitId:      visitorLogs.unitId,
    })
    .from(visitorLogs)
    .where(eq(visitorLogs.orgId, ctx.orgId))
    .orderBy(desc(visitorLogs.visitDate))
    .limit(50);

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-semibold text-slate-900">{t('title')}</h1>

      <Card padding="md">
        <h2 className="text-base font-medium text-slate-800 mb-4">{t('logVisitor')}</h2>
        <CreateVisitorForm />
      </Card>

      {visitors.length === 0 ? (
        <EmptyState title={t('emptyTitle')} description={t('emptyDesc')} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left">
                <th className="py-2 pr-4 font-medium text-slate-600">{t('colVisitor')}</th>
                <th className="py-2 pr-4 font-medium text-slate-600">{t('colDate')}</th>
                <th className="py-2 pr-4 font-medium text-slate-600">{t('colEntry')}</th>
                <th className="py-2 pr-4 font-medium text-slate-600">{t('colExit')}</th>
                <th className="py-2 font-medium text-slate-600">{t('colPurpose')}</th>
              </tr>
            </thead>
            <tbody>
              {visitors.map((v) => (
                <tr key={v.id} className="border-b border-slate-50 hover:bg-slate-50">
                  <td className="py-2 pr-4 text-slate-900">{v.visitorName}</td>
                  <td className="py-2 pr-4 text-slate-600">{v.visitDate}</td>
                  <td className="py-2 pr-4 text-slate-500">{v.entryTime ? new Date(v.entryTime).toLocaleTimeString() : '—'}</td>
                  <td className="py-2 pr-4 text-slate-500">{v.exitTime ? new Date(v.exitTime).toLocaleTimeString() : '—'}</td>
                  <td className="py-2 text-slate-500">{v.purpose ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
