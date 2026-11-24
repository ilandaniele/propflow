import { getTranslations } from 'next-intl/server';
import { switchCommunity } from '@/app/actions/communities';
import type { Community } from '@/lib/memberships/queries';

type Props = {
  communities: Community[];
  activeOrgId: string;
};

export async function CommunitySwitcher({ communities, activeOrgId }: Props) {
  if (communities.length < 2) return null;
  const t = await getTranslations('communities');

  return (
    <form action={switchCommunity} className="flex items-center gap-2">
      <label htmlFor="community_switch" className="sr-only">{t('switchLabel')}</label>
      <select id="community_switch" name="org_id" defaultValue={activeOrgId} className="h-8 min-w-0 flex-1 rounded border border-slate-300 px-2 text-xs">
        {communities.map((c) => (
          <option key={c.orgId} value={c.orgId}>{c.name} · {t(`role.${c.role}`)}</option>
        ))}
      </select>
      <button type="submit" className="text-xs font-medium text-brand-700 hover:underline">{t('switch')}</button>
    </form>
  );
}
