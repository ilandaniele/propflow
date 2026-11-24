'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';
import { saveCustomFieldValues } from '@/app/actions/custom-fields';
import { Button } from '@/components/ui/Button';
import type { ActionResult } from '@/lib/errors';
import type { CustomFieldWithValue } from '@/lib/custom-fields/queries';
import { fieldInputName, type CustomFieldEntityType } from '@/lib/custom-fields/schemas';

type Props = { entityType: CustomFieldEntityType; entityId: string; fields: CustomFieldWithValue[] };

const inputClasses = 'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500';

function FieldControl({ field, id }: { field: CustomFieldWithValue; id: string }) {
  const t = useTranslations('customFields');
  const name = fieldInputName(field.id);
  const value = field.value ?? '';
  switch (field.fieldType) {
    case 'boolean':
      return <input id={id} type="checkbox" name={name} defaultChecked={value === 'true'} className="rounded border-slate-300" />;
    case 'select':
      return (
        <select id={id} name={name} defaultValue={value} required={field.required} className={inputClasses}>
          <option value="">{t('selectPlaceholder')}</option>
          {(field.options ?? []).map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      );
    case 'number':
      return <input id={id} type="number" step="any" name={name} defaultValue={value} required={field.required} className={inputClasses} />;
    case 'date':
      return <input id={id} type="date" name={name} defaultValue={value} required={field.required} className={inputClasses} />;
    case 'text':
      return <input id={id} type="text" name={name} defaultValue={value} required={field.required} maxLength={500} className={inputClasses} />;
  }
}

export function CustomFieldsForm({ entityType, entityId, fields }: Props) {
  const t = useTranslations('customFields');
  const [state, action, pending] = useActionState<ActionResult, FormData>(saveCustomFieldValues, {});
  const fieldErrors = (state.error?.details as { fieldErrors?: Record<string, string[]> } | undefined)?.fieldErrors ?? {};

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="entity_type" value={entityType} />
      <input type="hidden" name="entity_id" value={entityId} />
      {fields.map((field) => {
        const id = `custom_field_${field.id}`;
        const error = fieldErrors[field.id]?.[0];
        return (
          <div key={field.id} className="grid grid-cols-1 sm:grid-cols-3 sm:items-center gap-1 sm:gap-3">
            <label htmlFor={id} className="text-sm font-medium text-slate-600">
              {field.label}{field.required && field.fieldType !== 'boolean' && <span className="text-red-500"> *</span>}
            </label>
            <div className="sm:col-span-2">
              <FieldControl field={field} id={id} />
              {error && <p className="mt-1 text-xs text-red-600" role="alert">{t(error === 'required' ? 'errorRequired' : 'errorInvalid')}</p>}
            </div>
          </div>
        );
      })}
      <div className="flex items-center justify-end gap-3">
        {state.error && <span className="text-sm text-red-600" role="alert">{t('errorSave')}</span>}
        {'data' in state && <span className="text-sm text-emerald-600" role="status">{t('saved')}</span>}
        <Button type="submit" loading={pending}>{t('save')}</Button>
      </div>
    </form>
  );
}
