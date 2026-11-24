'use client';

import { useActionState, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/Input';
import { uploadDocuments } from '@/app/actions/documents';
import {
  DOCUMENT_CATEGORIES,
  DOCUMENT_ENTITIES,
  MAX_DOCUMENT_UPLOAD_BYTES,
  MAX_DOCUMENTS_PER_UPLOAD,
  type DocumentEntity,
} from '@/lib/documents/types';
import type { EntityOptions } from '@/lib/documents/queries';
import type { DocumentUploadResult } from '@/lib/documents/upload';
import type { ActionResult } from '@/lib/errors';

const ACCEPT = 'application/pdf,image/jpeg,image/png,image/webp';

type UploadState = ActionResult<{ results: DocumentUploadResult[] }> | null;

function selectionExceedsLimits(files: FileList | null): boolean {
  if (!files) return false;
  const totalBytes = Array.from(files).reduce((total, file) => total + file.size, 0);
  return files.length > MAX_DOCUMENTS_PER_UPLOAD || totalBytes > MAX_DOCUMENT_UPLOAD_BYTES;
}

export function DocumentUploadForm({ options }: { options: EntityOptions }) {
  const t = useTranslations('documents');
  const formRef = useRef<HTMLFormElement>(null);
  const [entity, setEntity] = useState<DocumentEntity>('tenant');
  const [fileCount, setFileCount] = useState(0);
  const [overLimit, setOverLimit] = useState(false);
  const [state, action, pending] = useActionState<UploadState, FormData>(async (_prev, formData) => {
    const result = await uploadDocuments({}, formData);
    if (result.data?.results.every((outcome) => !outcome.error)) {
      formRef.current?.reset();
      setFileCount(0);
    }
    return result;
  }, null);

  const results = state?.data?.results ?? [];
  const uploadedCount = results.filter((outcome) => !outcome.error).length;
  const failed = results.filter((outcome) => outcome.error);

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
      {fileCount > 1 ? (
        <p className="self-end text-slate-600">{t('form.nameFromFiles')}</p>
      ) : (
        <Input name="name" id="document-name" label={t('form.name')} required maxLength={120} />
      )}
      <Select name="category" id="document-category" label={t('form.category')} defaultValue="other">
        {DOCUMENT_CATEGORIES.map((value) => <option key={value} value={value}>{t(`categories.${value}`)}</option>)}
      </Select>
      <Input name="expires_on" id="document-expires-on" type="date" label={t('form.expiresOn')} hint={t('form.expiresHint')} />
      <Input
        name="files"
        id="document-file"
        type="file"
        accept={ACCEPT}
        multiple
        required
        label={t('form.file')}
        hint={t('form.fileHint', { max: MAX_DOCUMENTS_PER_UPLOAD })}
        onChange={(e) => {
          setFileCount(e.target.files?.length ?? 0);
          setOverLimit(selectionExceedsLimits(e.target.files));
        }}
      />
      {entity !== 'property' && (
        <label className="flex items-center gap-2 text-slate-700 sm:col-span-2">
          <input type="checkbox" name="visible_to_tenant" className="h-4 w-4 rounded border-slate-300" />
          {t('form.visibleToTenant')}
        </label>
      )}
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
        <Button type="submit" disabled={pending || overLimit}>{pending ? t('form.uploading') : t('form.upload')}</Button>
        {overLimit && <p role="alert" className="text-red-600">{t('errors.tooMany', { max: MAX_DOCUMENTS_PER_UPLOAD })}</p>}
        {state?.error && <p role="alert" className="text-red-600">{t('errors.upload')}</p>}
        {uploadedCount > 0 && <p role="status" className="text-green-700">{t('form.uploaded', { count: uploadedCount })}</p>}
      </div>
      {failed.length > 0 && (
        <ul role="alert" className="list-disc pl-5 text-red-600 sm:col-span-2">
          {failed.map((outcome, index) => (
            <li key={`${outcome.file}-${index}`}>{t(`errors.file.${outcome.error!}`, { file: outcome.file })}</li>
          ))}
        </ul>
      )}
    </form>
  );
}
