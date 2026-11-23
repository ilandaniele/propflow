import { useTranslations } from 'next-intl';
import type { MessageKind, MessageStatus } from '@/lib/messages/schemas';

const STATUS_STYLES: Record<MessageStatus, string> = {
  open: 'bg-amber-50 text-amber-700',
  answered: 'bg-emerald-50 text-emerald-700',
  closed: 'bg-slate-100 text-slate-600',
};

export function MessageBadges({ kind, status }: { kind: string; status: string }) {
  const t = useTranslations('tenantMessages');
  return (
    <span className="flex items-center gap-1.5 text-xs">
      <span className="rounded-full bg-brand-50 px-2 py-0.5 text-brand-700">{t(`kind.${kind as MessageKind}`)}</span>
      <span className={`rounded-full px-2 py-0.5 ${STATUS_STYLES[status as MessageStatus] ?? STATUS_STYLES.closed}`}>{t(`status.${status as MessageStatus}`)}</span>
    </span>
  );
}
