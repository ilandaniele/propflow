'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { useTranslations } from 'next-intl';
import { updateEmailPreferences } from '@/app/actions/notificationPreferences';
import { Button } from '@/components/ui/Button';
import { EMAIL_CATEGORIES, type EmailCategory, type EmailPreferences } from '@/lib/notifications/email-categories';
import type { ActionResult } from '@/lib/errors';

const LABEL_KEYS: Record<EmailCategory, { label: string; hint: string }> = {
  lease_renewal: { label: 'leaseRenewal', hint: 'leaseRenewalHint' },
  payment_due:   { label: 'paymentDue',   hint: 'paymentDueHint' },
  announcements: { label: 'announcements', hint: 'announcementsHint' },
};

function SaveButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return <Button type="submit" size="sm" loading={pending}>{label}</Button>;
}

export function EmailPreferencesForm({ initial }: { initial: EmailPreferences }) {
  const t = useTranslations('notificationPreferences');
  const [state, action] = useActionState<ActionResult, FormData>(updateEmailPreferences, {});

  return (
    <form action={action} className="space-y-4">
      <div>
        <h2 className="text-base font-semibold text-slate-900">{t('title')}</h2>
        <p className="text-sm text-slate-500">{t('description')}</p>
      </div>

      <fieldset className="divide-y divide-slate-100">
        <legend className="sr-only">{t('title')}</legend>
        {EMAIL_CATEGORIES.map((category) => (
          <label key={category} className="flex items-start justify-between gap-4 py-3 cursor-pointer">
            <span>
              <span className="block text-sm font-medium text-slate-900">{t(LABEL_KEYS[category].label)}</span>
              <span className="block text-xs text-slate-500">{t(LABEL_KEYS[category].hint)}</span>
            </span>
            <input
              type="checkbox"
              name={category}
              defaultChecked={initial[category]}
              className="mt-1 h-4 w-4 shrink-0 rounded border-slate-300 text-brand-600 focus-visible:ring-brand-500"
            />
          </label>
        ))}
      </fieldset>

      <p className="text-xs text-slate-500">{t('alwaysSent')}</p>

      <div className="flex items-center gap-3">
        <SaveButton label={t('save')} />
        <p aria-live="polite" className="text-xs">
          {'data' in state && !state.error && <span className="text-emerald-700">{t('saved')}</span>}
          {state.error && <span role="alert" className="text-red-600">{t('error')}</span>}
        </p>
      </div>
    </form>
  );
}
