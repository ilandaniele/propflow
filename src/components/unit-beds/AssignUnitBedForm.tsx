'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';
import { assignUnitBed } from '@/app/actions/unit-beds';
import type { ActionResult } from '@/lib/errors';

type Props = {
  bedId: string;
  tenantId: string | null;
  tenants: { id: string; name: string }[];
};

export function AssignUnitBedForm({ bedId, tenantId, tenants }: Props) {
  const t = useTranslations('unitBeds');
  const [state, action, pending] = useActionState<ActionResult, FormData>(assignUnitBed, {});

  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="id" value={bedId} />
      <select
        name="tenant_id"
        defaultValue={tenantId ?? ''}
        aria-label={t('tenant')}
        className="rounded-md border border-slate-300 px-2 py-1 text-sm"
      >
        <option value="">{t('vacant')}</option>
        {tenants.map((tenant) => (
          <option key={tenant.id} value={tenant.id}>{tenant.name}</option>
        ))}
      </select>
      <button type="submit" disabled={pending} className="text-sm text-blue-600 hover:underline disabled:opacity-50">
        {t('assign')}
      </button>
      {state.error && <span className="text-xs text-red-600" role="alert">{state.error.message}</span>}
    </form>
  );
}
