export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getTranslations } from 'next-intl/server';
import { requireAdmin } from '@/lib/auth/guards';
import { todayStr } from '@/lib/notifications/reminder-engine';
import { addDaysUtc } from '@/lib/ops-calendar/dates';
import { listCalendarEvents } from '@/lib/ops-calendar/events';
import { toICalendar } from '@/lib/ops-calendar/ical';
import { summarizeEvent } from '@/lib/ops-calendar/summary';

const PAST_DAYS = 30;
const FUTURE_DAYS = 365;

export async function GET(): Promise<NextResponse> {
  let ctx;
  try { ctx = await requireAdmin(); } catch {
    return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: 'Admin access required.' } }, { status: 401 });
  }

  const today = todayStr();
  const [t, events] = await Promise.all([
    getTranslations('opsCalendar'),
    listCalendarEvents(ctx.orgId, addDaysUtc(today, -PAST_DAYS), addDaysUtc(today, FUTURE_DAYS)),
  ]);
  const body = toICalendar(events, {
    name: t('title'),
    now: Date.now(),
    summarize: (event) => summarizeEvent(event, (e) => t(`kinds.${e.kind}`, { count: e.count })),
  });

  return new NextResponse(body, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'attachment; filename="propflow-calendar.ics"',
      'Cache-Control': 'private, no-store',
    },
  });
}
