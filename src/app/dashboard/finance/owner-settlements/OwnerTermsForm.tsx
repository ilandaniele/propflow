'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { useTranslations } from 'next-intl';
import { savePropertyOwnerTerms } from '@/app/actions/owner-terms';
import { actionErrorMessage, type ActionResult } from '@/lib/errors';

type Option = { id: string; name: string | null };

function SubmitButton() {
  const t = useTranslations('ownerSettlements');
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50">
      {pending ? t('saving') : t('saveTerms')}
    </button>
  );
}

export function OwnerTermsForm({ properties, owners }: { properties: Option[]; owners: Option[] }) {
  const t = useTranslations('ownerSettlements');
  const [state, formAction] = useActionState<ActionResult | null, FormData>(savePropertyOwnerTerms, null);

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3 text-sm">
      <label className="flex flex-col gap-1">
        <span className="text-slate-600">{t('property')}</span>
        <select name="property_id" required className="rounded-lg border border-slate-300 px-2 py-1.5">
          {properties.map((option) => <option key={option.id} value={option.id}>{option.name ?? option.id}</option>)}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-slate-600">{t('owner')}</span>
        <select name="owner_id" required className="rounded-lg border border-slate-300 px-2 py-1.5">
          {owners.map((option) => <option key={option.id} value={option.id}>{option.name ?? option.id}</option>)}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-slate-600">{t('commissionPct')}</span>
        <input name="commission_pct" type="number" min="0" max="100" step="0.01" defaultValue="10" required className="w-24 rounded-lg border border-slate-300 px-2 py-1.5" />
      </label>
      <SubmitButton />
      {state?.error && <p role="alert" className="w-full text-red-600">{actionErrorMessage(state.error)}</p>}
      {state && !state.error && <p role="status" className="w-full text-green-700">{t('saved')}</p>}
    </form>
  );
}
