'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';
import { enableUnitCalendar, saveUnitCalendarImport, syncUnitCalendarNow } from '@/app/actions/unit-calendar';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import type { ActionResult } from '@/lib/errors';

function ActionError({ state }: { state: ActionResult }) {
  return state.error ? <p className="w-full text-sm text-red-600" role="alert">{state.error.message}</p> : null;
}

export function EnableUnitCalendarButton({ unitId }: { unitId: string }) {
  const t = useTranslations('unitCalendar');
  const [state, action, pending] = useActionState<ActionResult, FormData>(enableUnitCalendar, {});
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="unit_id" value={unitId} />
      <Button type="submit" disabled={pending}>{pending ? t('saving') : t('enable')}</Button>
      <ActionError state={state} />
    </form>
  );
}

export function UnitCalendarImportForm({ unitId, importUrl }: { unitId: string; importUrl: string | null }) {
  const t = useTranslations('unitCalendar');
  const [state, action, pending] = useActionState<ActionResult, FormData>(saveUnitCalendarImport, {});
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="unit_id" value={unitId} />
      <div className="min-w-0 flex-1">
        <Input id="unit_calendar_import_url" label={t('importUrl')} name="import_url" type="url" defaultValue={importUrl ?? ''} placeholder="https://www.airbnb.com/calendar/ical/….ics" />
      </div>
      <Button type="submit" disabled={pending}>{pending ? t('saving') : t('save')}</Button>
      <ActionError state={state} />
    </form>
  );
}

export function SyncUnitCalendarButton({ unitId }: { unitId: string }) {
  const t = useTranslations('unitCalendar');
  const [state, action, pending] = useActionState<ActionResult, FormData>(syncUnitCalendarNow, {});
  return (
    <form action={action}>
      <input type="hidden" name="unit_id" value={unitId} />
      <Button type="submit" variant="secondary" disabled={pending}>{pending ? t('syncing') : t('syncNow')}</Button>
      <ActionError state={state} />
    </form>
  );
}
