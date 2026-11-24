'use client';

import { useActionState, useState } from 'react';
import { useTranslations } from 'next-intl';
import { createCustomFieldDefinition } from '@/app/actions/custom-fields';
import { Button } from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/Input';
import { actionErrorMessage, type ActionResult } from '@/lib/errors';
import { CUSTOM_FIELD_ENTITY_TYPES, CUSTOM_FIELD_TYPES } from '@/lib/custom-fields/schemas';
import { EditableDefinitionFields } from './EditableDefinitionFields';

export function CreateDefinitionForm() {
  const t = useTranslations('customFields');
  const [state, action, pending] = useActionState<ActionResult, FormData>(createCustomFieldDefinition, {});
  const [fieldType, setFieldType] = useState<string>('text');

  return (
    <form action={action} className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Select id="cf_entity_type" label={t('entityType')} name="entity_type" required>
          {CUSTOM_FIELD_ENTITY_TYPES.map((e) => <option key={e} value={e}>{t(`entity.${e}`)}</option>)}
        </Select>
        <Select id="cf_field_type" label={t('fieldType')} name="field_type" value={fieldType} onChange={(e) => setFieldType(e.target.value)} required>
          {CUSTOM_FIELD_TYPES.map((type) => <option key={type} value={type}>{t(`type.${type}`)}</option>)}
        </Select>
        <Input id="cf_key" label={t('key')} name="key" required pattern="[a-z][a-z0-9_]{0,39}" maxLength={40} hint={t('keyHint')} />
      </div>
      <EditableDefinitionFields idPrefix="cf_new" showOptions={fieldType === 'select'} />
      <Button type="submit" loading={pending}>{t('create')}</Button>
      {state.error && <p className="text-sm text-red-600" role="alert">{actionErrorMessage(state.error)}</p>}
    </form>
  );
}
