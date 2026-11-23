import { asc, eq } from 'drizzle-orm';
import { requireAdmin } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { units } from '@/lib/db/schema';
import { getTranslations } from 'next-intl/server';
import { EmptyState } from '@/components/ui/EmptyState';
import { Card } from '@/components/ui/Card';
import { AuthorizedVisitorsCard } from '@/components/visitors/AuthorizedVisitorsCard';
import { PassphraseCheckForm } from '@/components/visitors/PassphraseCheckForm';
import { listAuthorizedVisitors, listVisitorLogs } from '@/lib/visitors/queries';
import { CreateVisitorForm } from './CreateVisitorForm';

export default async function AdminVisitorsPage({ searchParams }: { searchParams: Promise<{ code?: string }> }) {
  const ctx = await requireAdmin();
  const t = await getTranslations('visitors');
  const code = (await searchParams).code?.trim() || undefined;

  const [visitors, authorized, unitOptions] = await Promise.all([
    listVisitorLogs(ctx.orgId, { passphrase: code }),
    listAuthorizedVisitors(ctx.orgId),
    db.select({ id: units.id, label: units.label }).from(units)
      .where(eq(units.orgId, ctx.orgId)).orderBy(asc(units.label)),
  ]);

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-semibold text-slate-900">{t('title')}</h1>

      <Card padding="md">
        <h2 className="text-base font-medium text-slate-800 mb-4">{t('logVisitor')}</h2>
        <CreateVisitorForm />
      </Card>

      <PassphraseCheckForm code={code} clearHref="/dashboard/visitors" />

      {visitors.length === 0 ? (
        <EmptyState
          title={code ? t('noMatchTitle') : t('emptyTitle')}
          description={code ? t('noMatchDesc') : t('emptyDesc')}
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left">
                <th className="py-2 pr-4 font-medium text-slate-600">{t('colVisitor')}</th>
                <th className="py-2 pr-4 font-medium text-slate-600">{t('colUnit')}</th>
                <th className="py-2 pr-4 font-medium text-slate-600">{t('colDate')}</th>
                <th className="py-2 pr-4 font-medium text-slate-600">{t('colEntry')}</th>
                <th className="py-2 pr-4 font-medium text-slate-600">{t('colExit')}</th>
                <th className="py-2 pr-4 font-medium text-slate-600">{t('colPurpose')}</th>
                <th className="py-2 font-medium text-slate-600">{t('colPassphrase')}</th>
              </tr>
            </thead>
            <tbody>
              {visitors.map((v) => (
                <tr key={v.id} className="border-b border-slate-50 hover:bg-slate-50">
                  <td className="py-2 pr-4 text-slate-900">{v.visitorName}</td>
                  <td className="py-2 pr-4 text-slate-600">{v.unitLabel ?? '—'}</td>
                  <td className="py-2 pr-4 text-slate-600">{v.visitDate}</td>
                  <td className="py-2 pr-4 text-slate-500">{v.entryTime ? new Date(v.entryTime).toLocaleTimeString() : '—'}</td>
                  <td className="py-2 pr-4 text-slate-500">{v.exitTime ? new Date(v.exitTime).toLocaleTimeString() : '—'}</td>
                  <td className="py-2 pr-4 text-slate-500">{v.purpose ?? '—'}</td>
                  <td className="py-2 font-mono text-slate-700">{v.passphrase ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <AuthorizedVisitorsCard rows={authorized} units={unitOptions} />
    </div>
  );
}
