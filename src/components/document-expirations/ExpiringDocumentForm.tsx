'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';
import { createExpiringDocument } from '@/app/actions/document-expirations';
import { Button } from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/Input';
import type { ActionResult } from '@/lib/errors';
import type { SubjectOption } from '@/lib/document-expirations/queries';
import { EXPIRING_DOCUMENT_KINDS } from '@/lib/db/schema/document-expiry';

type Props = { tenants: SubjectOption[]; properties: SubjectOption[] };

export function ExpiringDocumentForm({ tenants, properties }: Props) {
  const t = useTranslations('documentExpirations');
  const [state, action, pending] = useActionState<ActionResult, FormData>(createExpiringDocument, {});

  return (
    <form action={action} className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
      <Select id="expiring_kind" label={t('kind')} name="kind" defaultValue="dni">
        {EXPIRING_DOCUMENT_KINDS.map((kind) => <option key={kind} value={kind}>{t(`kinds.${kind}`)}</option>)}
      </Select>
      <Input id="expiring_label" label={t('label')} name="label" required maxLength={200} />
      <Input id="expiring_date" label={t('expiresOn')} name="expires_on" type="date" required />
      <Select id="expiring_tenant" label={t('tenant')} name="tenant_id" defaultValue="">
        <option value="">{t('none')}</option>
        {tenants.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
      </Select>
      <Select id="expiring_property" label={t('property')} name="property_id" defaultValue="">
        <option value="">{t('none')}</option>
        {properties.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
      </Select>
      <Button type="submit" disabled={pending}>{pending ? t('saving') : t('add')}</Button>
      {state.error && <p className="sm:col-span-3 text-sm text-red-600" role="alert">{state.error.message}</p>}
    </form>
  );
}
