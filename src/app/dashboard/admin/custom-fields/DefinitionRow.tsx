'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';
import { removeCustomFieldDefinition, updateCustomFieldDefinition } from '@/app/actions/custom-fields';
import { Button } from '@/components/ui/Button';
import { actionErrorMessage, type ActionResult } from '@/lib/errors';
import type { CustomFieldDefinition } from '@/lib/custom-fields/queries';
import { EditableDefinitionFields } from './EditableDefinitionFields';

export function DefinitionRow({ definition }: { definition: CustomFieldDefinition }) {
  const t = useTranslations('customFields');
  const [updateState, updateAction, updating] = useActionState<ActionResult, FormData>(updateCustomFieldDefinition, {});
  const [removeState, removeAction, removing] = useActionState<ActionResult, FormData>(removeCustomFieldDefinition, {});
  const error = updateState.error ?? removeState.error;

  return (
    <li className="py-3 text-sm">
      <details>
        <summary className="flex flex-wrap items-center justify-between gap-3 cursor-pointer list-none">
          <span className="min-w-0">
            <span className="font-medium text-slate-900">{definition.label}</span>
            {definition.required && <span className="text-red-500"> *</span>}
            <span className="ml-2 text-slate-500"><code>{definition.key}</code> · {t(`type.${definition.fieldType}`)}</span>
          </span>
          <span className="text-brand-600 hover:underline">{t('edit')}</span>
        </summary>
        <form action={updateAction} className="mt-3 space-y-3">
          <input type="hidden" name="id" value={definition.id} />
          <EditableDefinitionFields idPrefix={`cf_${definition.id}`} showOptions={definition.fieldType === 'select'} defaults={definition} />
          <div className="flex items-center gap-3">
            <Button type="submit" size="sm" loading={updating}>{t('save')}</Button>
            <Button type="submit" size="sm" variant="ghost" formAction={removeAction} loading={removing} className="text-red-600">
              {t('remove')}
            </Button>
          </div>
        </form>
      </details>
      {error && <p className="mt-1 text-xs text-red-600" role="alert">{actionErrorMessage(error)}</p>}
    </li>
  );
}
