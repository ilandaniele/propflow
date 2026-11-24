'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { useTranslations } from 'next-intl';
import { toggleAnnouncementPin } from '@/app/actions/ops';
import type { ActionResult } from '@/lib/errors';

function ToggleButton({ pinned }: { pinned: boolean }) {
  const t = useTranslations('announcements');
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="text-xs text-brand-600 hover:underline font-medium disabled:opacity-50">
      {pinned ? t('unpin') : t('pin')}
    </button>
  );
}

export function PinToggle({ id, pinned }: { id: string; pinned: boolean }) {
  const [state, action] = useActionState<ActionResult, FormData>(toggleAnnouncementPin, {});
  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="pinned" value={pinned ? 'false' : 'true'} />
      <ToggleButton pinned={pinned} />
      {state.error && <p className="text-xs text-red-600" role="alert">{state.error.message}</p>}
    </form>
  );
}
