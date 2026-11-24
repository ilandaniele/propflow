'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';
import { addCommunityMember } from '@/app/actions/communities';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import type { ActionResult } from '@/lib/errors';

export function AddMemberForm() {
  const t = useTranslations('communities');
  const [state, action, pending] = useActionState<ActionResult, FormData>(addCommunityMember, {});

  return (
    <form action={action} className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
      <Input label={t('emailLabel')} name="email" type="email" required maxLength={254} />
      <div className="space-y-1">
        <label htmlFor="member_role" className="block text-sm font-medium text-slate-700">{t('roleLabel')}</label>
        <select id="member_role" name="role" defaultValue="admin" className="h-9 w-full rounded border border-slate-300 px-2 text-sm">
          <option value="admin">{t('role.admin')}</option>
          <option value="tenant">{t('role.tenant')}</option>
        </select>
      </div>
      <Button type="submit" disabled={pending}>{pending ? t('saving') : t('add')}</Button>
      {state.error && <p className="sm:col-span-3 text-sm text-red-600" role="alert">{state.error.message}</p>}
    </form>
  );
}
