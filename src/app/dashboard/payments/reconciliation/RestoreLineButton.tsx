'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';
import { setBankLineIgnored } from '@/app/actions/bank-reconciliation';
import type { ActionResult } from '@/lib/errors';
import { Button } from '@/components/ui/Button';

export function RestoreLineButton({ lineId }: { lineId: string }) {
  const t = useTranslations('bankReconciliation.actions');
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(setBankLineIgnored, null);

  return (
    <form action={formAction} className="flex items-center gap-2">
      <input type="hidden" name="line_id" value={lineId} />
      <input type="hidden" name="ignored" value="false" />
      <Button type="submit" size="sm" variant="secondary" loading={pending}>{t('restore')}</Button>
      {state?.error && <span role="alert" className="text-xs text-red-600">{state.error.message}</span>}
    </form>
  );
}
