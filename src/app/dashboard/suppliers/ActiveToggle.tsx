'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';
import { setSupplierActive } from '@/app/actions/suppliers';
import { actionErrorMessage, type ActionResult } from '@/lib/errors';
import { Button } from '@/components/ui/Button';

export function ActiveToggle({ id, active }: { id: string; active: boolean }) {
  const t = useTranslations('suppliers');
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(setSupplierActive, null);

  return (
    <form action={formAction}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="active" value={active ? 'false' : 'true'} />
      <Button type="submit" size="sm" variant="ghost" loading={pending}>{active ? t('deactivate') : t('activate')}</Button>
      {state?.error && <p role="alert" className="text-xs text-red-600">{actionErrorMessage(state.error)}</p>}
    </form>
  );
}
