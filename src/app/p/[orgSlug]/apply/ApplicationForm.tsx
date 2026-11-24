'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { useTranslations } from 'next-intl';
import type { ActionResult } from '@/lib/errors';
import { Input, Select, Textarea } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { EMPLOYMENT_TYPES } from '@/lib/schemas/rental-application';

interface ApplicationFormProps {
  action: (prev: ActionResult | null, formData: FormData) => Promise<ActionResult>;
  listingSlug: string;
  accept: string;
  maxDocuments: number;
}

function SubmitButton() {
  const t = useTranslations('rentalApplication');
  const { pending } = useFormStatus();
  return <Button type="submit" disabled={pending}>{pending ? t('sending') : t('submit')}</Button>;
}

function errorText(state: ActionResult | null, t: ReturnType<typeof useTranslations>): string | null {
  if (!state?.error) return null;
  if (state.error.code === 'RATE_LIMITED') return t('errors.rateLimited');
  if (state.error.code !== 'VALIDATION_ERROR') return t('errors.generic');
  const fields = Object.keys((state.error.details as { fieldErrors?: Record<string, string[]> } | undefined)?.fieldErrors ?? {});
  return t('errors.validation', { fields: fields.map((field) => t(`fields.${field}`)).join(', ') });
}

export function ApplicationForm({ action, listingSlug, accept, maxDocuments }: ApplicationFormProps) {
  const t = useTranslations('rentalApplication');
  const [state, formAction] = useActionState(action, null);

  if (state && !state.error) {
    return (
      <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-5">
        <p className="font-medium text-emerald-900">{t('successTitle')}</p>
        <p className="text-sm text-emerald-800 mt-1">{t('successBody')}</p>
      </div>
    );
  }

  const error = errorText(state, t);

  return (
    <form action={formAction} className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
      <input type="hidden" name="listing_slug" value={listingSlug} />
      <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" className="hidden" />

      <Input id="full_name" name="full_name" label={t('fields.full_name')} required autoComplete="name" />
      <div className="grid sm:grid-cols-2 gap-4">
        <Input id="email" name="email" type="email" label={t('fields.email')} required autoComplete="email" />
        <Input id="phone" name="phone" type="tel" label={t('fields.phone')} required autoComplete="tel" />
      </div>
      <div className="grid sm:grid-cols-2 gap-4">
        <Input id="monthly_income" name="monthly_income" type="number" min="1" step="0.01" label={t('fields.monthly_income')} required />
        <Select id="employment_type" name="employment_type" label={t('fields.employment_type')} required defaultValue="employee">
          {EMPLOYMENT_TYPES.map((type) => <option key={type} value={type}>{t(`employment.${type}`)}</option>)}
        </Select>
      </div>
      <div className="grid sm:grid-cols-3 gap-4">
        <Input id="employment_months" name="employment_months" type="number" min="0" label={t('fields.employment_months')} required />
        <Input id="household_size" name="household_size" type="number" min="1" defaultValue="1" label={t('fields.household_size')} required />
        <Input id="move_in_date" name="move_in_date" type="date" label={t('fields.move_in_date')} />
      </div>
      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" name="has_guarantor" className="rounded border-slate-300" />
        {t('fields.has_guarantor')}
      </label>
      <div className="space-y-1">
        <label htmlFor="documents" className="block text-sm font-medium text-slate-700">{t('fields.documents')}</label>
        <input id="documents" name="documents" type="file" multiple accept={accept} className="block w-full text-sm text-slate-600" />
        <p className="text-xs text-slate-500">{t('documentsHint', { max: maxDocuments })}</p>
      </div>
      <Textarea id="message" name="message" label={t('fields.message')} maxLength={1000} />
      <label className="flex items-start gap-2 text-sm text-slate-700">
        <input type="checkbox" name="privacy_accepted" required className="mt-0.5 rounded border-slate-300" />
        <span>{t.rich('privacy', { link: (chunks) => <a href="/privacidad" className="text-brand-600 hover:underline">{chunks}</a> })}</span>
      </label>

      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      <SubmitButton />
    </form>
  );
}
