import { redirect } from 'next/navigation';
import { getLocale } from 'next-intl/server';
import { getCachedUser, getProfileFast } from '@/lib/auth/guards';
import { TenantNav } from '@/components/shell/TenantNav';
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
  const currentLocale = (await getLocale()) as Locale;

  return (
    <div className="min-h-screen flex flex-col bg-slate-50">
      <TenantNav userName={profile.full_name} profileId={user.id} currentLocale={currentLocale} />
      <main className="flex-1 max-w-2xl mx-auto w-full px-4 py-6 pb-20 sm:pb-6" id="main-content">
        {children}
      </main>
    </div>
  );
}
