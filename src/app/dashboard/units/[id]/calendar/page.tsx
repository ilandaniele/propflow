import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { requireAdmin } from '@/lib/auth/guards';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { getAppOrigin } from '@/lib/widget/origins';
import { getUnitCalendar, listUpcomingBlocks, unitBelongsToOrg } from '@/lib/unit-calendar/queries';
import {
  EnableUnitCalendarButton,
  SyncUnitCalendarButton,
  UnitCalendarImportForm,
} from '@/components/unit-calendar/UnitCalendarForms';

export const metadata: Metadata = { title: 'Unit calendar' };

export default async function UnitCalendarPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let ctx;
  try { ctx = await requireAdmin(); } catch { redirect('/login'); }

  if (!(await unitBelongsToOrg(ctx.orgId, id))) notFound();

  const t = await getTranslations('unitCalendar');
  const today = new Date().toISOString().slice(0, 10);
  const [calendar, blocks] = await Promise.all([getUnitCalendar(ctx.orgId, id), listUpcomingBlocks(ctx.orgId, id, today)]);

  let appOrigin: string | null;
  try { appOrigin = getAppOrigin(); } catch { appOrigin = null; }

  return (
    <div className="max-w-2xl space-y-4">
      <Link href={`/dashboard/units/${id}`} className="text-sm text-slate-500 hover:text-slate-700">
        {t('back')}
      </Link>

      <Card>
        <CardHeader>
          <CardTitle>{t('title')}</CardTitle>
        </CardHeader>
        <p className="mb-4 text-sm text-slate-500">{t('subtitle')}</p>

        {!calendar ? (
          <EnableUnitCalendarButton unitId={id} />
        ) : (
          <div className="space-y-6">
            <section className="space-y-1">
              <h3 className="text-sm font-medium text-slate-900">{t('exportTitle')}</h3>
              <p className="text-xs text-slate-500">{t('exportHelp')}</p>
              <code className="block break-all rounded bg-slate-50 p-2 text-xs text-slate-700">
                {`${appOrigin ?? ''}/api/public/calendar/${calendar.exportToken}.ics`}
              </code>
            </section>

            <section className="space-y-2">
              <h3 className="text-sm font-medium text-slate-900">{t('importTitle')}</h3>
              <p className="text-xs text-slate-500">{t('importHelp')}</p>
              <UnitCalendarImportForm unitId={id} importUrl={calendar.importUrl} />
              {calendar.importUrl && (
                <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
                  <SyncUnitCalendarButton unitId={id} />
                  <span>
                    {calendar.lastSyncedAt
                      ? t('lastSynced', { date: calendar.lastSyncedAt.toLocaleString() })
                      : t('neverSynced')}
                  </span>
                  {calendar.lastSyncError && <span className="text-red-600">{t('syncError', { error: calendar.lastSyncError })}</span>}
                </div>
              )}
            </section>

            <section className="space-y-2">
              <h3 className="text-sm font-medium text-slate-900">{t('blocksTitle')}</h3>
              {blocks.length === 0 ? (
                <p className="text-sm text-slate-400">{t('noBlocks')}</p>
              ) : (
                <ul className="divide-y divide-slate-100 text-sm">
                  {blocks.map((b) => (
                    <li key={b.id} className="flex justify-between py-2">
                      <span>{t('range', { from: b.startsOn, to: b.endsOn })}</span>
                      <span className="text-slate-500">{b.summary ?? t('blocked')}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}
      </Card>
    </div>
  );
}
