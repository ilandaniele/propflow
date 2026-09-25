'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { setPublicPages } from '@/app/actions/agent-widget';
import type { ActionResult } from '@/lib/errors';

function SaveButton() {
  const t = useTranslations('agentWidget');
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="px-4 py-2 text-sm font-medium text-white bg-brand-600 hover:bg-brand-700 rounded-lg disabled:opacity-50 transition-colors"
    >
      {pending ? t('saving') : t('save')}
    </button>
  );
}

export interface PublicPagesFormProps {
  enabled: boolean;
  orgSlug: string | null;
  appOrigin: string | null;
}

/** The /p/<orgSlug> catalogue pages on/off toggle, plus a link to the live catalogue. */
export function PublicPagesForm({ enabled, orgSlug, appOrigin }: PublicPagesFormProps) {
  const t = useTranslations('agentWidget');
  const [pagesEnabled, setPagesEnabled] = useState(enabled);
  const [state, action] = useActionState<ActionResult, FormData>(setPublicPages, {});

  return (
    <form action={action} className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
      <input type="hidden" name="enabled" value={pagesEnabled ? 'true' : 'false'} />

      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={pagesEnabled}
            onChange={(e) => setPagesEnabled(e.target.checked)}
            className="rounded border-slate-300"
          />
          {t('publicPagesEnabled')}
        </label>
        <SaveButton />
        {orgSlug && (
          <Link
            href={`/p/${orgSlug}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-brand-600 hover:underline"
          >
            {t('viewCatalogue')} {appOrigin ? `${appOrigin}/p/${orgSlug}` : `/p/${orgSlug}`}
          </Link>
        )}
      </div>
      {state.error && <p className="text-xs text-red-600">{state.error.message}</p>}
      {!state.error && state.data !== undefined && <p className="text-xs text-green-600">{t('savedOk')}</p>}
    </form>
  );
}
