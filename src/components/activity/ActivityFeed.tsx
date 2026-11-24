import { getTranslations } from 'next-intl/server';
import { Card } from '@/components/ui/Card';
import { ACTIVITY_ACTIONS, type ActivityAction } from '@/lib/activity/actions';
import type { listActivity } from '@/lib/activity/queries';

type Props = {
  events: Awaited<ReturnType<typeof listActivity>>;
  from?: string;
  to?: string;
  basePath: string;
};

const isKnownAction = (action: string): action is ActivityAction =>
  (ACTIVITY_ACTIONS as readonly string[]).includes(action);

export async function ActivityFeed({ events, from, to, basePath }: Props) {
  const t = await getTranslations('activity');
  const visible = events.filter((event) => isKnownAction(event.action));

  return (
    <div className="space-y-4">
      <form method="get" className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <label htmlFor="from" className="block text-sm font-medium text-slate-700">{t('from')}</label>
          <input id="from" name="from" type="date" defaultValue={from ?? ''} className="h-9 rounded border border-slate-300 px-2 text-sm" />
        </div>
        <div className="space-y-1">
          <label htmlFor="to" className="block text-sm font-medium text-slate-700">{t('to')}</label>
          <input id="to" name="to" type="date" defaultValue={to ?? ''} className="h-9 rounded border border-slate-300 px-2 text-sm" />
        </div>
        <button type="submit" className="h-9 rounded bg-slate-800 px-3 text-sm text-white">{t('filter')}</button>
        {(from || to) && <a href={basePath} className="text-sm text-brand-600 hover:underline">{t('clear')}</a>}
      </form>

      <Card padding="md">
        {visible.length === 0 ? (
          <p className="text-sm text-slate-500">{t('empty')}</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {visible.map((event) => (
              <li key={event.id} className="flex items-start justify-between gap-3 py-2 text-sm">
                <div>
                  <p className="font-medium text-slate-900">{t(`action.${event.action as ActivityAction}`)}</p>
                  {event.summary && <p className="text-slate-500">{event.summary}</p>}
                </div>
                <time dateTime={event.createdAt.toISOString()} className="shrink-0 text-slate-500">
                  {event.createdAt.toISOString().slice(0, 10)}
                </time>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
