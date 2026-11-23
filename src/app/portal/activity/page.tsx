import { getTranslations } from 'next-intl/server';
import { requireTenant } from '@/lib/auth/guards';
import { ActivityFeed } from '@/components/activity/ActivityFeed';
import { resolveActivityRange } from '@/lib/activity/filters';
import { listActivity } from '@/lib/activity/queries';

type SearchParams = Promise<{ from?: string; to?: string }>;

export default async function PortalActivityPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireTenant();
  const t = await getTranslations('activity');
  const params = await searchParams;
  const events = await listActivity(ctx.orgId, resolveActivityRange(params));

  return (
    <div className="p-4 pb-20 sm:pb-4 space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">{t('title')}</h1>
        <p className="text-sm text-slate-500">{t('subtitle')}</p>
      </div>
      <ActivityFeed events={events} from={params.from} to={params.to} basePath="/portal/activity" />
    </div>
  );
}
