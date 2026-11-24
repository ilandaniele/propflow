import { getTranslations } from 'next-intl/server';
import { requireAdmin } from '@/lib/auth/guards';
import { Card } from '@/components/ui/Card';
import { AddMemberForm } from '@/components/communities/AddMemberForm';
import { RemoveMemberButton } from '@/components/communities/RemoveMemberButton';
import { listOrgMembers } from '@/lib/memberships/queries';
import type { MemberRole } from '@/lib/memberships/schemas';

export default async function CommunityMembersPage() {
  const ctx = await requireAdmin();
  const t = await getTranslations('communities');
  const members = await listOrgMembers(ctx.orgId);

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">{t('title')}</h1>
        <p className="text-sm text-slate-500">{t('subtitle')}</p>
      </div>
      <Card padding="md">
        <h2 className="text-base font-medium text-slate-800 mb-4">{t('addTitle')}</h2>
        <AddMemberForm />
      </Card>
      <Card padding="md">
        {members.length === 0 ? (
          <p className="text-sm text-slate-500">{t('empty')}</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {members.map((member) => (
              <li key={member.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <div>
                  <p className="font-medium text-slate-900">{member.name ?? member.email}</p>
                  <p className="text-slate-500">{member.email} · {t(`role.${member.role as MemberRole}`)}</p>
                </div>
                <RemoveMemberButton id={member.id} />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
