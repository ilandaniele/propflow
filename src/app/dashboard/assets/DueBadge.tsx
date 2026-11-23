import { getTranslations } from 'next-intl/server';
import { Badge } from '@/components/ui/Badge';
import type { DueStatus } from '@/lib/assets/maintenance-math';

const VARIANT = { overdue: 'danger', soon: 'warning', ok: 'success' } as const;

export async function DueBadge({ status, due }: { status: DueStatus; due: string }) {
  const t = await getTranslations('assets.due');
  return <Badge variant={VARIANT[status]}>{t(status, { date: due })}</Badge>;
}
