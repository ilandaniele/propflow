'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';
import { saveRentSchedule } from '@/app/actions/rent-schedule';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import type { ActionResult } from '@/lib/errors';

export function RentScheduleToggle({ enabled }: { enabled: boolean }) {
  const t = useTranslations('rentSchedule');
  const [state, action, pending] = useActionState<ActionResult, FormData>(saveRentSchedule, {});
  return (
    <Card padding="md">
      <form action={action} className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-slate-900">{t('title')}</p>
          <p className="text-xs text-slate-500">{enabled ? t('onHelp') : t('offHelp')}</p>
        </div>
        <input type="hidden" name="enabled" value={String(!enabled)} />
        <Button type="submit" variant={enabled ? 'secondary' : 'primary'} disabled={pending}>
          {enabled ? t('disable') : t('enable')}
        </Button>
        {state.error && <p className="w-full text-sm text-red-600" role="alert">{state.error.message}</p>}
      </form>
    </Card>
  );
}
