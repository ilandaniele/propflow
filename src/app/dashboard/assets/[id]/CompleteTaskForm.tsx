'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';
import { completeAssetTask } from '@/app/actions/assets';
import { actionErrorMessage, type ActionResult } from '@/lib/errors';
import { Button } from '@/components/ui/Button';

export function CompleteTaskForm({ taskId, today }: { taskId: string; today: string }) {
  const t = useTranslations('assets.complete');
  const [state, formAction, pending] = useActionState<ActionResult<{ logId: string }> | null, FormData>(completeAssetTask, null);

  return (
    <form action={formAction} className="flex flex-wrap items-center justify-end gap-2">
      <input type="hidden" name="task_id" value={taskId} />
      <input
        type="date"
        name="done_on"
        defaultValue={today}
        max={today}
        aria-label={t('doneOn')}
        required
        className="rounded-md border border-slate-300 px-2 py-1 text-xs"
      />
      <input
        type="number"
        name="cost"
        min={0}
        step="0.01"
        placeholder={t('cost')}
        aria-label={t('cost')}
        className="w-24 rounded-md border border-slate-300 px-2 py-1 text-xs"
      />
      <Button type="submit" size="sm" variant="secondary" loading={pending}>{t('submit')}</Button>
      {state?.error && <p role="alert" className="w-full text-right text-xs text-red-600">{actionErrorMessage(state.error)}</p>}
    </form>
  );
}
