import { redirect } from 'next/navigation';
import { getSessionFast } from '@/lib/supabase/server';
import { getProfileFast } from '@/lib/auth/guards';
import { TenantNav } from '@/components/shell/TenantNav';

/**
 * Portal layout — fast-path auth (spec AC4).
 *
 * BEFORE (3 sequential network calls — ~250ms total):
 *   1. supabase.auth.getUser()         — network JWT round-trip (~150ms)
 *   2. profiles SELECT                 — network DB query (~50ms)
 *   3. notification_inbox count SELECT — network DB query (~50ms)
 *
 * AFTER (0 network calls in the layout):
 *   1. getSessionFast()     — reads cookie only (middleware already validated JWT)
 *   2. getProfileFast()     — unstable_cache (60s TTL, cross-request, no live DB round-trip on warm cache)
 *   3. notification count   — deferred to <NotificationBadge> client component (fetches on mount)
 *
 * Security: middleware (src/proxy.ts) calls getUser() → JWT validation on every
 * matched request. Pages that fetch sensitive data call requireTenant() which
 * triggers a fresh getUser() round-trip (defense-in-depth per spec IC5).
 */
export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  // Fast path: reads the middleware-validated cookie — zero network round-trip
  const session = await getSessionFast();
  if (!session) {
    redirect('/login');
  }

  // getProfileFast is backed by unstable_cache (60 s TTL) — no live DB round-trip
  // on repeated navigations within the TTL window. The userId comes from the
  // middleware-validated session, not from client-supplied input.
  const profile = await getProfileFast(session.user.id);

  if (!profile || profile.role !== 'tenant') {
    redirect('/dashboard');
  }

  // Notification count is NOT fetched here — it is deferred to NotificationBadge
  // (a 'use client' component) so the layout streams immediately without waiting
  // for the notification_inbox query.
  return (
    <div className="min-h-screen flex flex-col bg-slate-50">
      <TenantNav userName={profile.full_name} profileId={session.user.id} />
      <main className="flex-1 max-w-2xl mx-auto w-full px-4 py-6 pb-20 sm:pb-6" id="main-content">
        {children}
      </main>
    </div>
  );
}
