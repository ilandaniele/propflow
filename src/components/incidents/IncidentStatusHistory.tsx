import { getTranslations } from 'next-intl/server';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { StatusPill } from '@/components/ui/Badge';
import type { IncidentStatusEvent } from '@/lib/incidents/history';

export async function IncidentStatusHistory({ events }: { events: IncidentStatusEvent[] }) {
  const t = await getTranslations('incidentHistory');
  return (
    <Card>
      <CardHeader><CardTitle>{t('title')}</CardTitle></CardHeader>
      {events.length === 0 ? (
        <p className="text-sm text-slate-400">{t('empty')}</p>
      ) : (
        <ol className="space-y-3">
          {events.map((event) => (
            <li key={event.id} className="text-sm">
              <div className="flex flex-wrap items-center gap-1">
                <StatusPill status={event.fromStatus} />
                <span className="text-slate-400" aria-hidden>→</span>
                <StatusPill status={event.toStatus} />
              </div>
              <p className="text-xs text-slate-500 mt-1">
                {event.changedByName ?? t('unknown')} · {event.createdAt.toLocaleString('es-PE')}
              </p>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
