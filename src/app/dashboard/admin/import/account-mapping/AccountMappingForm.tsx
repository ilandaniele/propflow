'use client';

/**
 * AccountMappingForm — client form to add a new account mapping.
 * Calls saveAccountMapping Server Action.
 * Pre-populated dropdown with 14 standard internal categories.
 */

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { useTranslations } from 'next-intl';
import { saveAccountMapping } from '@/app/actions/mappings';
import type { ActionResult } from '@/lib/errors';
import type { AccountMapping } from '@/app/actions/mappings';

// 14 standard internal categories from spec
const INTERNAL_CATEGORIES = [
  'Alquiler',
  'Servicios',
  'Mantenimiento',
  'Limpieza',
  'Suministros',
  'Seguros',
  'Impuestos y tasas',
  'turn_cost',
  'capex',
  'debt_service',
  'platform_fees',
  'Gastos administrativos',
  'Otros gastos',
  'Ingresos varios',
] as const;

function SubmitButton() {
  const t = useTranslations('adminImport.accountMapping');
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="px-4 py-2 text-sm font-medium rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50 transition-colors"
    >
      {pending ? t('saving') : t('save')}
    </button>
  );
}

type State = ActionResult<AccountMapping> | null;

export function AccountMappingForm() {
  const t = useTranslations('adminImport.accountMapping');
  const [state, formAction] = useActionState<State, FormData>(
    saveAccountMapping as (prev: State, formData: FormData) => Promise<State>,
    null
  );

  const isSuccess = state && !state.error && state.data;

  return (
    <form action={formAction} className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="externalAccount" className="block text-xs font-medium text-slate-600 mb-1">
            {t('externalCodeLabel')}
          </label>
          <input
            id="externalAccount"
            name="externalAccount"
            type="text"
            required
            placeholder={t('externalCodePlaceholder')}
            className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-brand-500 outline-none"
          />
        </div>
        <div>
          <label htmlFor="internalCategory" className="block text-xs font-medium text-slate-600 mb-1">
            {t('internalCategoryLabel')}
          </label>
          <select
            id="internalCategory"
            name="internalCategory"
            className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-brand-500 outline-none"
          >
            <option value="">{t('selectCategory')}</option>
            {INTERNAL_CATEGORIES.map((cat) => (
              <option key={cat} value={cat}>{cat}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex items-center gap-6">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            name="isIncome"
            value="true"
            className="w-4 h-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
          />
          <span className="text-sm text-slate-700">{t('isIncome')}</span>
        </label>

        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            name="affectsNetProfit"
            value="true"
            defaultChecked
            className="w-4 h-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
          />
          <span className="text-sm text-slate-700">{t('affectsNetProfit')}</span>
        </label>
      </div>

      <div className="flex items-center gap-3">
        <SubmitButton />
        {isSuccess && (
          <span className="text-sm text-green-600" role="status">{t('savedOk')}</span>
        )}
        {state?.error && (
          <span className="text-sm text-red-600" role="alert">{state.error.message}</span>
        )}
      </div>
    </form>
  );
}
