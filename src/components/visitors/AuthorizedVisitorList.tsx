'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';
import { removeAuthorizedVisitor } from '@/app/actions/visitors';
import type { ActionResult } from '@/lib/errors';

export interface AuthorizedVisitorRow {
  id: string;
  fullName: string;
  documentNumber: string | null;
  relationship: string | null;
  unitLabel: string;
}

function RemoveButton({ id }: { id: string }) {
  const t = useTranslations('visitorAccess');
  const [state, action, pending] = useActionState<ActionResult, FormData>(removeAuthorizedVisitor, {});
  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="id" value={id} />
      <button type="submit" disabled={pending} className="text-sm text-red-600 hover:underline disabled:opacity-50">{t('remove')}</button>
      {state.error && <span className="text-xs text-red-600" role="alert">{state.error.message}</span>}
    </form>
  );
}

export function AuthorizedVisitorList({ rows, showUnit }: { rows: AuthorizedVisitorRow[]; showUnit: boolean }) {
  const t = useTranslations('visitorAccess');
  if (rows.length === 0) return <p className="text-sm text-slate-500">{t('emptyAuthorized')}</p>;

  return (
    <ul className="divide-y divide-slate-100">
      {rows.map((row) => (
        <li key={row.id} className="flex items-center justify-between gap-3 py-2">
          <div className="text-sm">
            <p className="font-medium text-slate-900">{row.fullName}</p>
            <p className="text-slate-500">
              {[showUnit ? row.unitLabel : null, row.relationship, row.documentNumber].filter(Boolean).join(' · ') || '—'}
            </p>
          </div>
          <RemoveButton id={row.id} />
        </li>
      ))}
    </ul>
  );
}
