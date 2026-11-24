'use client';

import { useActionState, useEffect, useRef } from 'react';
import { useFormStatus } from 'react-dom';
import { useTranslations } from 'next-intl';
import { sendTenantMessage } from '@/app/actions/tenant-messages';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { MESSAGE_ATTACHMENT_MIMES, MESSAGE_KINDS } from '@/lib/messages/schemas';
import { actionErrorMessage, type ActionResult } from '@/lib/errors';

function hasAttachmentError(error: NonNullable<ActionResult['error']>): boolean {
  const details = error.details as { fieldErrors?: Record<string, string[]> } | undefined;
  return Boolean(details?.fieldErrors?.attachment?.length);
}

const FIELD_CLASS = 'border border-slate-300 rounded-lg px-3 py-2 text-sm w-full focus:outline-none focus:ring-2 focus:ring-brand-500';

function SubmitButton() {
  const t = useTranslations('tenantMessages');
  const { pending } = useFormStatus();
  return <Button type="submit" size="sm" disabled={pending}>{t('send')}</Button>;
}

export function SendMessageForm() {
  const t = useTranslations('tenantMessages');
  const [state, action] = useActionState<ActionResult, FormData>(sendTenantMessage, {});
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (!state.error && 'data' in state) formRef.current?.reset();
  }, [state]);

  return (
    <form ref={formRef} action={action} className="space-y-3">
      <div className="space-y-1">
        <label htmlFor="message-kind" className="block text-sm font-medium text-slate-700">{t('kindLabel')}</label>
        <select id="message-kind" name="kind" required defaultValue="question" className={FIELD_CLASS}>
          {MESSAGE_KINDS.map((kind) => <option key={kind} value={kind}>{t(`kind.${kind}`)}</option>)}
        </select>
      </div>
      <Input label={t('subjectLabel')} name="subject" required maxLength={120} />
      <div className="space-y-1">
        <label htmlFor="message-body" className="block text-sm font-medium text-slate-700">{t('bodyLabel')}</label>
        <textarea id="message-body" name="body" required rows={4} maxLength={2000} className={FIELD_CLASS} />
      </div>
      <div className="space-y-1">
        <label htmlFor="message-attachment" className="block text-sm font-medium text-slate-700">{t('attachmentLabel')}</label>
        <input
          id="message-attachment"
          name="attachment"
          type="file"
          accept={MESSAGE_ATTACHMENT_MIMES.join(',')}
          aria-describedby="message-attachment-hint"
          className="w-full text-sm text-slate-500 file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:text-xs file:font-medium file:bg-slate-100 file:text-slate-700 hover:file:bg-slate-200 cursor-pointer"
        />
        <p id="message-attachment-hint" className="text-xs text-slate-500">{t('attachmentHint')}</p>
      </div>
      <SubmitButton />
      {state.error && (
        <p className="text-sm text-red-600" role="alert">
          {hasAttachmentError(state.error) ? t('attachmentInvalid') : actionErrorMessage(state.error)}
        </p>
      )}
    </form>
  );
}
