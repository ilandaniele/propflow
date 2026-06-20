import { getTranslations } from 'next-intl/server';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import type { ActivityEvent } from '@/lib/tenants/activity-feed';

const TYPE_COLORS: Record<string, string> = {
  payment: 'bg-green-100 text-green-700',
  incident: 'bg-red-100 text-red-700',
  task: 'bg-blue-100 text-blue-700',
  sanction: 'bg-amber-100 text-amber-700',
  whatsapp: 'bg-emerald-100 text-emerald-700',
  note: 'bg-slate-100 text-slate-700',
};

export async function ActivityTab({ events }: { events: ActivityEvent[] }) {
  const t = await getTranslations('tenantTabs.activityTab');
  return (
    <div className="p-4">
      <Card>
        <CardHeader><CardTitle>{t('title')}</CardTitle></CardHeader>
        {events.length === 0 ? (
          <p className="text-sm text-slate-400">{t('emptyState')}</p>
        ) : (
          <ol className="relative border-l border-slate-200 ml-2 space-y-4 py-2">
            {events.map((e) => (
              <li key={`${e.type}-${e.id}`} className="ml-4">
                <div className="absolute -left-1.5 mt-1.5 h-3 w-3 rounded-full border-2 border-white bg-brand-400" />
                <div className="flex items-start gap-3">
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full mt-0.5 shrink-0 ${TYPE_COLORS[e.type] ?? 'bg-slate-100 text-slate-700'}`}>
                    {e.type}
                  </span>
                  <div>
                    <p className="text-sm text-slate-900">{e.label}</p>
                    {e.detail && <p className="text-xs text-slate-500">{e.detail}</p>}
                    {e.status && (
                      <p className="text-xs text-slate-400">{e.status}</p>
                    )}
                    <p className="text-xs text-slate-400 mt-0.5">{new Date(e.createdAt).toLocaleString()}</p>
                  </div>
                </div>
              </li>
            ))}
          </ol>
        )}
      </Card>
    </div>
  );
}
