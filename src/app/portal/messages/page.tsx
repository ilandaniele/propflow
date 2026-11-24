import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { requireTenant } from '@/lib/auth/guards';
import { listSentMessages } from '@/lib/messages/queries';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { MessageBadges } from '@/components/messages/MessageBadges';
import { MessageAttachmentLink } from '@/components/messages/MessageAttachmentLink';
import { SendMessageForm } from './SendMessageForm';

export default async function PortalMessagesPage() {
  let ctx;
  try { ctx = await requireTenant(); } catch { redirect('/login'); }
  const t = await getTranslations('tenantMessages');
  const messages = await listSentMessages(ctx.orgId, ctx.userId);

  return (
    <div className="p-4 pb-20 sm:pb-4 space-y-4">
      <h1 className="text-xl font-semibold text-slate-900">{t('portalTitle')}</h1>

      <Card padding="md">
        <h2 className="text-base font-medium text-slate-800 mb-3">{t('newMessage')}</h2>
        <SendMessageForm />
      </Card>

      {messages.length === 0 ? (
        <EmptyState title={t('emptyTitle')} description={t('emptyPortalDesc')} />
      ) : (
        <div className="space-y-3">
          {messages.map((message) => (
            <Card key={message.id} padding="md">
              <div className="flex items-start justify-between gap-3">
                <h2 className="font-medium text-slate-900">{message.subject}</h2>
                <MessageBadges kind={message.kind} status={message.status} />
              </div>
              <p className="text-xs text-slate-500 mt-0.5">{message.createdAt.toISOString().slice(0, 10)}</p>
              <p className="mt-2 whitespace-pre-line text-sm text-slate-700">{message.body}</p>
              <MessageAttachmentLink messageId={message.id} name={message.attachmentName} size={message.attachmentSize} />
              {message.reply && (
                <div className="mt-3 rounded-lg bg-brand-50 p-3">
                  <p className="text-xs font-medium text-brand-700">{t('replyHeading')}</p>
                  <p className="mt-1 whitespace-pre-line text-sm text-slate-800">{message.reply}</p>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
