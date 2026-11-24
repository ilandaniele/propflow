'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { useTranslations } from 'next-intl';
import { closeTenantMessage, replyTenantMessage } from '@/app/actions/tenant-messages';
import { Button } from '@/components/ui/Button';
import { actionErrorMessage, type ActionResult } from '@/lib/errors';

function SubmitButton({ label, variant = 'primary' }: { label: string; variant?: 'primary' | 'secondary' }) {
  const { pending } = useFormStatus();
  return <Button type="submit" size="sm" variant={variant} disabled={pending}>{label}</Button>;
}

export function ReplyForm({ messageId, currentReply }: { messageId: string; currentReply: string | null }) {
  const t = useTranslations('tenantMessages');
  const [state, action] = useActionState<ActionResult, FormData>(replyTenantMessage, {});

  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="message_id" value={messageId} />
      <label htmlFor={`reply-${messageId}`} className="sr-only">{t('replyLabel')}</label>
      <textarea id={`reply-${messageId}`} name="reply" required rows={3} defaultValue={currentReply ?? ''} placeholder={t('replyPlaceholder')} className="border border-slate-300 rounded-lg px-3 py-2 text-sm w-full focus:outline-none focus:ring-2 focus:ring-brand-500" />
      <SubmitButton label={currentReply ? t('updateReply') : t('sendReply')} />
      {state.error && <p className="text-sm text-red-600" role="alert">{actionErrorMessage(state.error)}</p>}
    </form>
  );
}

export function CloseMessageForm({ messageId }: { messageId: string }) {
  const t = useTranslations('tenantMessages');
  const [state, action] = useActionState<ActionResult, FormData>(closeTenantMessage, {});

  return (
    <form action={action}>
      <input type="hidden" name="message_id" value={messageId} />
      <SubmitButton label={t('close')} variant="secondary" />
      {state.error && <p className="text-xs text-red-600" role="alert">{actionErrorMessage(state.error)}</p>}
    </form>
  );
}
