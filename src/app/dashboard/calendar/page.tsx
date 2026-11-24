import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { requireAdmin } from '@/lib/auth/guards';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { todayStr } from '@/lib/notifications/reminder-engine';
import { CALENDAR_TIMEZONE, monthRange, parseMonth, shiftMonth } from '@/lib/ops-calendar/dates';
import { groupByDay, listCalendarEvents, type CalendarEventKind } from '@/lib/ops-calendar/events';
import { eventSubject } from '@/lib/ops-calendar/summary';

export const metadata: Metadata = { title: 'Calendar' };

const KIND_VARIANT: Record<CalendarEventKind, 'success' | 'warning' | 'danger' | 'info' | 'pending'> = {
  contract_start: 'success',
  contract_end: 'danger',
  charge_due: 'warning',
  cleaning: 'pending',
  visit: 'info',
};

export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  let ctx;
  try { ctx = await requireAdmin(); } catch { redirect('/login'); }

  const today = todayStr();
  const { month: rawMonth } = await searchParams;
  const month = parseMonth(typeof rawMonth === 'string' ? rawMonth : undefined, today);
  const { from, to } = monthRange(month);
  const [t, locale, events] = await Promise.all([
    getTranslations('opsCalendar'),
    getLocale(),
    listCalendarEvents(ctx.orgId, from, to),
  ]);
  const days = groupByDay(events);
  const monthLabel = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${from}T00:00:00Z`));
  const dayLabel = new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
  const timeLabel = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', timeZone: CALENDAR_TIMEZONE });

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{t('title')}</h1>
          <p className="text-sm text-slate-500 mt-1">{t('subtitle')}</p>
        </div>
        <a href="/api/calendar/ics" className="text-sm text-brand-600 hover:underline">{t('download')}</a>
      </div>

      <div className="flex items-center justify-between">
        <Link href={`/dashboard/calendar?month=${shiftMonth(month, -1)}`} className="text-sm text-slate-600 hover:text-slate-900">← {t('previous')}</Link>
        <h2 className="text-lg font-semibold capitalize text-slate-900">{monthLabel}</h2>
        <Link href={`/dashboard/calendar?month=${shiftMonth(month, 1)}`} className="text-sm text-slate-600 hover:text-slate-900">{t('next')} →</Link>
      </div>

      {days.length === 0 ? (
        <Card padding="md"><p className="text-sm text-slate-500">{t('empty')}</p></Card>
      ) : (
        days.map(({ day, events: dayEvents }) => (
          <Card key={day} padding="none">
            <h3 className={`px-4 pt-4 pb-2 text-sm font-semibold capitalize ${day === today ? 'text-brand-700' : 'text-slate-700'}`}>
              {dayLabel.format(new Date(`${day}T00:00:00Z`))}
            </h3>
            <ul className="divide-y divide-slate-100">
              {dayEvents.map((event) => (
                <li key={`${event.kind}-${event.refId}`} className="flex items-center gap-3 px-4 py-3 text-sm">
                  <Badge variant={KIND_VARIANT[event.kind]}>{t(`kinds.${event.kind}`, { count: event.count })}</Badge>
                  <span className="text-slate-900">{eventSubject(event)}</span>
                  {event.startAt !== null && <span className="ml-auto text-slate-500">{timeLabel.format(new Date(event.startAt))}</span>}
                </li>
              ))}
            </ul>
          </Card>
        ))
      )}
    </div>
  );
}
