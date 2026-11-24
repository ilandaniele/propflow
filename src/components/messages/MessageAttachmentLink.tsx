import { useTranslations } from 'next-intl';

const KILOBYTE = 1024;

export function MessageAttachmentLink({ messageId, name, size }: { messageId: string; name: string | null; size: number | null }) {
  const t = useTranslations('tenantMessages');
  if (!name) return null;
  return (
    <a
      href={`/api/tenant-messages/${messageId}/attachment`}
      target="_blank"
      rel="noopener noreferrer"
      className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1 text-xs text-brand-700 hover:bg-slate-50"
      aria-label={t('attachmentOpen', { name })}
    >
      <span aria-hidden="true">📎</span>
      <span className="max-w-[16rem] truncate">{name}</span>
      {size ? <span className="text-slate-500">{t('attachmentSize', { kb: Math.max(1, Math.round(size / KILOBYTE)) })}</span> : null}
    </a>
  );
}
