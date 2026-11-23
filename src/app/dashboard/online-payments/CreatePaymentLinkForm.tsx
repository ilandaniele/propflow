'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { useTranslations } from 'next-intl';
import { createPaymentLink } from '@/app/actions/online-payments';
import { Button } from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/Input';
import { actionErrorMessage, type ActionResult } from '@/lib/errors';

interface LinkableCharge {
  id: string;
  label: string;
}

function SubmitButton() {
  const t = useTranslations('onlinePaymentsForm');
  const { pending } = useFormStatus();
  return <Button type="submit" loading={pending} size="sm">{t('submit')}</Button>;
}

export function CreatePaymentLinkForm({ charges }: { charges: LinkableCharge[] }) {
  const t = useTranslations('onlinePaymentsForm');
  const [state, action] = useActionState<ActionResult<{ url: string }>, FormData>(createPaymentLink, {});
  const [copied, setCopied] = useState(false);
  const url = state.data?.url;

  async function copy() {
    if (!url) return;
    await navigator.clipboard.writeText(url);
    setCopied(true);
  }

  return (
    <form action={action} onSubmit={() => setCopied(false)} className="space-y-4">
      <Select label={t('chargeLabel')} name="charge_id" required>
        <option value="">{t('selectCharge')}</option>
        {charges.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
      </Select>
      <SubmitButton />
      {state.error && <p role="alert" className="text-sm text-red-600">{actionErrorMessage(state.error)}</p>}
      {url && (
        <div className="flex gap-2 items-end">
          <div className="flex-1">
            <Input label={t('linkLabel')} value={url} readOnly onFocus={(e) => e.currentTarget.select()} />
          </div>
          <Button type="button" variant="secondary" size="sm" onClick={copy}>{copied ? t('copied') : t('copy')}</Button>
        </div>
      )}
    </form>
  );
}
