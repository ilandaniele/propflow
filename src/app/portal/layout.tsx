import { redirect } from 'next/navigation';
import { getLocale } from 'next-intl/server';
import { getCachedUser, getProfileFast, getOrgNameFast } from '@/lib/auth/guards';
import { getOrgBranding } from '@/lib/branding/org-branding';
import { TenantNav } from '@/components/shell/TenantNav';
import { CommunitySwitcher } from '@/components/communities/CommunitySwitcher';
import { listUserCommunities } from '@/lib/memberships/queries';
import type { Locale } from '@/i18n/config';

/**
 * Portal layout — fast-path auth (spec AC4).
 *
 * Uses NextAuth getCachedUser() — no Supabase dependency.
 * getProfileFast() queries Drizzle directly for the tenant profile row.
 */
export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const user = await getCachedUser();
  if (!user) {
    redirect('/login');
  }

  const profile = await getProfileFast(user.id);

  if (!profile || profile.role !== 'tenant') {
    redirect('/dashboard');
  }

  // Notification count is NOT fetched here — it is deferred to NotificationBadge
  // (a 'use client' component) so the layout streams immediately without waiting
  // for the notification_inbox query.

  // getLocale() reads the locale from the next-intl cookie/config — no DB round-trip.
  // This is the single source of truth for the active locale in server components.
  const [currentLocale, communities, branding, orgName] = await Promise.all([
    getLocale() as Promise<Locale>,
    listUserCommunities(user.id),
    getOrgBranding(profile.org_id),
    getOrgNameFast(profile.org_id),
  ]);

  return (
    <div className="min-h-screen flex flex-col bg-slate-50">
      <TenantNav
        userName={profile.full_name}
        profileId={user.id}
        currentLocale={currentLocale}
        logoUrl={branding.logoUrl}
        orgName={orgName}
        communitySwitcher={<CommunitySwitcher communities={communities} activeOrgId={profile.org_id} />}
      />
      <main className="flex-1 max-w-2xl mx-auto w-full px-4 py-6 pb-20 sm:pb-6" id="main-content">
        {children}
      </main>
    </div>
  );
}
