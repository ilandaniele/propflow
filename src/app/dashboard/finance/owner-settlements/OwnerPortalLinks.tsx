'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { useTranslations } from 'next-intl';
import { createOwnerPortalLinkAction, revokeOwnerPortalLinkAction } from '@/app/actions/owner-portal';
import { actionErrorMessage, type ActionResult } from '@/lib/errors';

type Option = { id: string; name: string | null };
type ActiveLink = { id: string; ownerName: string | null; expiresAt: Date; lastViewedAt: Date | null };

const formatDate = (value: Date) => value.toISOString().slice(0, 10);

function SubmitButton({ label, pendingLabel, variant }: { label: string; pendingLabel: string; variant: 'primary' | 'ghost' }) {
  const { pending } = useFormStatus();
  const style = variant === 'primary'
    ? 'rounded-lg bg-slate-900 px-3 py-1.5 font-medium text-white hover:bg-slate-700'
    : 'rounded-lg border border-slate-300 px-2 py-1 text-slate-700 hover:bg-slate-50';
  return <button type="submit" disabled={pending} className={`${style} disabled:opacity-50`}>{pending ? pendingLabel : label}</button>;
}

async function revoke(formData: FormData) {
  await revokeOwnerPortalLinkAction(formData);
}

export function OwnerPortalLinks({ owners, links }: { owners: Option[]; links: ActiveLink[] }) {
  const t = useTranslations('ownerPortal');
  const [state, formAction] = useActionState<ActionResult<{ url: string }> | null, FormData>(createOwnerPortalLinkAction, null);

  return (
    <div className="space-y-4 text-sm">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">{t('adminTitle')}</h2>
        <p className="text-slate-500">{t('adminDesc')}</p>
      </div>
      {owners.length === 0 ? (
        <p className="text-slate-500">{t('noOwners')}</p>
      ) : (
        <form action={formAction} className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-slate-600">{t('owner')}</span>
            <select name="owner_id" required className="rounded-lg border border-slate-300 px-2 py-1.5">
              {owners.map((option) => <option key={option.id} value={option.id}>{option.name ?? option.id}</option>)}
            </select>
          </label>
          <SubmitButton label={t('create')} pendingLabel={t('creating')} variant="primary" />
        </form>
      )}
      {state?.error && <p role="alert" className="text-red-600">{actionErrorMessage(state.error)}</p>}
      {state?.data && (
        <div role="status" className="space-y-1 rounded-lg bg-green-50 p-3">
          <p className="text-green-800">{t('created')}</p>
          <input
            readOnly
            value={state.data.url}
            onFocus={(event) => event.currentTarget.select()}
            aria-label={t('linkLabel')}
            className="w-full rounded border border-green-200 bg-white px-2 py-1 font-mono text-xs"
          />
        </div>
      )}
      {links.length > 0 && (
        <ul className="divide-y divide-slate-100">
          {links.map((link) => (
            <li key={link.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span className="text-slate-900">{link.ownerName ?? link.id}</span>
              <span className="text-slate-500">
                {t('expires', { date: formatDate(link.expiresAt) })} · {link.lastViewedAt ? t('lastViewed', { date: formatDate(link.lastViewedAt) }) : t('neverViewed')}
              </span>
              <form action={revoke}>
                <input type="hidden" name="link_id" value={link.id} />
                <SubmitButton label={t('revoke')} pendingLabel={t('revoking')} variant="ghost" />
              </form>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
