import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/Badge';
import type { ScheduleState } from '@/lib/incidents/schedule-math';

export function ScheduleBadge({ state }: { state: ScheduleState }) {
  const t = useTranslations('incidents.schedule');
  if (!state) return null;
  return <Badge variant={state === 'overdue' ? 'danger' : 'info'}>{t(state)}</Badge>;
}
