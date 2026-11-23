'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';
import { setStaffRoleAction } from '@/app/actions/team';
import { STAFF_ROLES } from '@/lib/auth/permissions';
import type { TeamMember } from '@/lib/team/queries';

const ROLE_OPTIONS = ['admin', ...STAFF_ROLES] as const;

function MemberRow({ member, isSelf }: { member: TeamMember; isSelf: boolean }) {
  const t = useTranslations('team');
  const [state, formAction, pending] = useActionState(setStaffRoleAction, null);

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-3">
      <div className="min-w-0">
        <p className="font-medium text-slate-900 truncate">{member.fullName ?? member.email ?? '—'}</p>
        {member.fullName && member.email && <p className="text-xs text-slate-500 truncate">{member.email}</p>}
      </div>
      {isSelf ? (
        <span className="text-xs text-slate-500">{t('you')}</span>
      ) : (
        <form action={formAction} className="flex items-center gap-2">
          <input type="hidden" name="profile_id" value={member.profileId} />
          <label className="sr-only" htmlFor={`role-${member.profileId}`}>{t('roleLabel')}</label>
          <select
            id={`role-${member.profileId}`}
            name="role"
            defaultValue={member.staffRole ?? 'admin'}
            className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
          >
            {ROLE_OPTIONS.map((role) => <option key={role} value={role}>{t(`roles.${role}`)}</option>)}
          </select>
          <button type="submit" disabled={pending} className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
            {pending ? t('saving') : t('save')}
          </button>
          {state?.error && <span role="alert" className="text-xs text-red-600">{t('error')}</span>}
          {state && !state.error && <span className="text-xs text-green-600">{t('saved')}</span>}
        </form>
      )}
    </li>
  );
}

export function TeamRoles({ members, selfProfileId }: { members: TeamMember[]; selfProfileId: string }) {
  const t = useTranslations('team');

  return (
    <div className="space-y-4 text-sm">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">{t('title')}</h1>
        <p className="text-slate-500">{t('description')}</p>
      </div>
      <ul className="text-xs text-slate-600 space-y-1">
        {ROLE_OPTIONS.map((role) => <li key={role}><strong>{t(`roles.${role}`)}:</strong> {t(`roleHelp.${role}`)}</li>)}
      </ul>
      <ul className="divide-y divide-slate-100" role="list">
        {members.map((member) => <MemberRow key={member.profileId} member={member} isSelf={member.profileId === selfProfileId} />)}
      </ul>
      {members.length <= 1 && <p className="text-slate-500">{t('onlyYou')}</p>}
    </div>
  );
}
