import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { requireAdmin } from '@/lib/auth/guards';
import { listInboxMessages } from '@/lib/messages/queries';
import { InboxFilterSchema, MESSAGE_STATUSES } from '@/lib/messages/schemas';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { MessageBadges } from '@/components/messages/MessageBadges';
import { MessageAttachmentLink } from '@/components/messages/MessageAttachmentLink';
import { CloseMessageForm, ReplyForm } from './InboxForms';

export const metadata: Metadata = { title: 'Mensajes' };

export default async function TenantMessagesInboxPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  let ctx;
  try { ctx = await requireAdmin(); } catch { redirect('/login'); }
  const { status } = InboxFilterSchema.parse(await searchParams);
  const t = await getTranslations('tenantMessages');
  const messages = await listInboxMessages(ctx.orgId, status);
  const filters = [undefined, ...MESSAGE_STATUSES];

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">{t('inboxTitle')}</h1>
        <p className="text-sm text-slate-500 mt-1">{t('inboxSubtitle')}</p>
      </div>

      <nav className="flex gap-2" aria-label={t('filterLabel')}>
        {filters.map((value) => (
          <Link
            key={value ?? 'all'}
            href={value ? `?status=${value}` : '?'}
            aria-current={value === status ? 'page' : undefined}
            className={`rounded-full px-3 py-1 text-sm ${value === status ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}
          >
            {value ? t(`status.${value}`) : t('all')}
          </Link>
        ))}
      </nav>

      {messages.length === 0 ? (
        <EmptyState title={t('emptyTitle')} description={t('emptyInboxDesc')} />
      ) : (
        <div className="space-y-4">
          {messages.map((message) => (
            <Card key={message.id} padding="md">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="font-medium text-slate-900">{message.subject}</h2>
                  <p className="text-xs text-slate-500 mt-0.5">{message.senderName ?? t('unknownSender')} · {message.createdAt.toISOString().slice(0, 10)}</p>
                </div>
                <MessageBadges kind={message.kind} status={message.status} />
              </div>
              <p className="mt-3 whitespace-pre-line text-sm text-slate-700">{message.body}</p>
              <MessageAttachmentLink messageId={message.id} name={message.attachmentName} size={message.attachmentSize} />
              {message.status !== 'closed' && (
                <div className="mt-4 space-y-2 border-t border-slate-100 pt-4">
                  <ReplyForm messageId={message.id} currentReply={message.reply} />
                  <CloseMessageForm messageId={message.id} />
                </div>
              )}
              {message.status === 'closed' && message.reply && (
                <p className="mt-3 whitespace-pre-line rounded-lg bg-slate-50 p-3 text-sm text-slate-700">{message.reply}</p>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
