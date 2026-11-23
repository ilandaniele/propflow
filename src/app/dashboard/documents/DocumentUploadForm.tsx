'use client';

import { useActionState, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/Input';
import { uploadDocument } from '@/app/actions/documents';
import { DOCUMENT_CATEGORIES, DOCUMENT_ENTITIES, type DocumentEntity } from '@/lib/documents/types';
import type { EntityOptions } from '@/lib/documents/queries';
import type { ActionResult } from '@/lib/errors';

const ACCEPT = 'application/pdf,image/jpeg,image/png,image/webp';

export function DocumentUploadForm({ options }: { options: EntityOptions }) {
  const t = useTranslations('documents');
  const formRef = useRef<HTMLFormElement>(null);
  const [entity, setEntity] = useState<DocumentEntity>('tenant');
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(async (_prev, formData) => {
    const result = await uploadDocument({}, formData);
    if (!result.error) formRef.current?.reset();
    return result;
  }, null);

  return (
    <form ref={formRef} action={action} className="grid gap-3 text-sm sm:grid-cols-2">
      <Select
        name="entity_type"
        id="document-entity-type"
        label={t('form.entityType')}
        value={entity}
        onChange={(e) => setEntity(e.target.value as DocumentEntity)}
      >
        {DOCUMENT_ENTITIES.map((value) => <option key={value} value={value}>{t(`entities.${value}`)}</option>)}
      </Select>
      <Select key={entity} name="entity_id" id="document-entity-id" label={t(`entities.${entity}`)} required>
        <option value="">{t('form.choose')}</option>
        {options[entity].map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
      </Select>
      <Input name="name" id="document-name" label={t('form.name')} required maxLength={120} />
      <Select name="category" id="document-category" label={t('form.category')} defaultValue="other">
        {DOCUMENT_CATEGORIES.map((value) => <option key={value} value={value}>{t(`categories.${value}`)}</option>)}
      </Select>
      <Input name="expires_on" id="document-expires-on" type="date" label={t('form.expiresOn')} hint={t('form.expiresHint')} />
      <Input name="file" id="document-file" type="file" accept={ACCEPT} required label={t('form.file')} hint={t('form.fileHint')} />
      {entity !== 'property' && (
        <label className="flex items-center gap-2 text-slate-700 sm:col-span-2">
          <input type="checkbox" name="visible_to_tenant" className="h-4 w-4 rounded border-slate-300" />
          {t('form.visibleToTenant')}
        </label>
      )}
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
        <Button type="submit" disabled={pending}>{pending ? t('form.uploading') : t('form.upload')}</Button>
        {state?.error && <p role="alert" className="text-red-600">{t('errors.upload')}</p>}
        {state && !state.error && <p role="status" className="text-green-700">{t('form.uploaded')}</p>}
      </div>
    </form>
  );
}
