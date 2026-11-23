import { getTranslations } from 'next-intl/server';
import { Badge } from '@/components/ui/Badge';
import { slaState } from '@/lib/incidents/sla';

type Props = {
  incident: { priority: string; status: string; createdAt: Date; resolvedAt: Date | null };
  onlyBreached?: boolean;
};

export async function SlaBadge({ incident, onlyBreached = false }: Props) {
  const sla = slaState(incident);
  if (onlyBreached && !(sla.breached && !sla.done)) return null;
  const t = await getTranslations('incidentSla');
  if (sla.done) return <Badge variant={sla.breached ? 'warning' : 'success'}>{t(sla.breached ? 'metLate' : 'met')}</Badge>;
  if (sla.breached) return <Badge variant="danger">{t('breached')}</Badge>;
  return <Badge variant="default">{t('due', { date: sla.deadline.toLocaleDateString('es-PE') })}</Badge>;
}
