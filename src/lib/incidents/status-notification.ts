import { getTranslations } from 'next-intl/server';
import { notificationInbox } from '@/lib/db/schema';

export type IncidentStatus = 'pending' | 'in_progress' | 'solved';

type Target = { orgId: string; incidentId: string; incidentTitle: string; tenantProfileId: string | null };

export function statusChanged(previous: string, next: IncidentStatus | undefined): next is IncidentStatus {
  return next !== undefined && next !== previous;
}

export async function buildStatusNotification(
  target: Target,
  status: IncidentStatus,
): Promise<typeof notificationInbox.$inferInsert | null> {
  if (!target.tenantProfileId) return null;
  const t = await getTranslations('incidentNotification');
  return {
    orgId: target.orgId,
    profileId: target.tenantProfileId,
    type: 'incident_status',
    title: t(`title.${status}`),
    body: t('body', { title: target.incidentTitle, status: t(`status.${status}`) }),
    relatedType: 'incident',
    relatedId: target.incidentId,
  };
}
