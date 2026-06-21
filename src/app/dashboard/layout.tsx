import { redirect } from 'next/navigation';
import { getLocale } from 'next-intl/server';
import { getCachedUser, getProfileFast, getOrgNameFast } from '@/lib/auth/guards';
import { AdminSidebar } from '@/components/shell/AdminSidebar';
import { AdminTopbar } from '@/components/shell/AdminTopbar';
import type { Locale } from '@/i18n/config';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  // Validate NextAuth session and fetch profile for layout rendering.
  const user = await getCachedUser();
  if (!user) {
    redirect('/login');
  }

  const profile = await getProfileFast(user.id);

  if (!profile || profile.role !== 'admin') {
    redirect('/login');
  }

  // getOrgNameFast is backed by unstable_cache (300 s TTL) — the org name rarely
  // changes; tagging with 'org-{orgId}' allows targeted invalidation when needed.
  const orgName = await getOrgNameFast(profile.org_id);

  // getLocale() reads the locale from the next-intl cookie/config — no DB round-trip.
  // This is the single source of truth for the active locale in server components.
  const currentLocale = (await getLocale()) as Locale;

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50">
      <AdminSidebar orgName={orgName ?? undefined} />
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        <AdminTopbar userName={profile.full_name} currentLocale={currentLocale} />
        <main className="flex-1 overflow-y-auto p-6" id="main-content">
          {children}
        </main>
      </div>
    </div>
  );
}
