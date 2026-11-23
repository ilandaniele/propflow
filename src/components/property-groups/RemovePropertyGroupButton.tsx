'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';
import { removePropertyGroup } from '@/app/actions/property-groups';
import type { ActionResult } from '@/lib/errors';

export function RemovePropertyGroupButton({ id }: { id: string }) {
  const t = useTranslations('propertyGroups');
  const [state, action, pending] = useActionState<ActionResult, FormData>(removePropertyGroup, {});

  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="id" value={id} />
      <button type="submit" disabled={pending} className="text-sm text-red-600 hover:underline disabled:opacity-50">{t('remove')}</button>
      {state.error && <span className="text-xs text-red-600" role="alert">{state.error.message}</span>}
    </form>
  );
}
