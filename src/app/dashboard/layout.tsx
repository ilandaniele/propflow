import { redirect } from 'next/navigation';
import { getSessionFast } from '@/lib/supabase/server';
import { getProfileFast, getOrgNameFast } from '@/lib/auth/guards';
import { AdminSidebar } from '@/components/shell/AdminSidebar';
import { AdminTopbar } from '@/components/shell/AdminTopbar';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  // Fast path: read session from the middleware-validated cookie — zero network
  // round-trips. The middleware (src/proxy.ts) calls getUser() on every request
  // and refreshes the cookie before the layout runs, so the cookie is trusted.
  const session = await getSessionFast();
  if (!session) {
    redirect('/login');
  }

  // getProfileFast is backed by unstable_cache (60 s TTL) — no live DB round-trip
  // on repeated navigations. The userId comes from the middleware-validated session,
  // not from client-supplied input, so it is safe to use as a cache key.
  const profile = await getProfileFast(session.user.id);

  if (!profile || profile.role !== 'admin') {
    redirect('/login');
  }

  // getOrgNameFast is backed by unstable_cache (300 s TTL) — the org name rarely
  // changes; tagging with 'org-{orgId}' allows targeted invalidation when needed.
  const orgName = await getOrgNameFast(profile.org_id);

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50">
      <AdminSidebar orgName={orgName ?? undefined} />
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        <AdminTopbar userName={profile.full_name} />
        <main className="flex-1 overflow-y-auto p-6" id="main-content">
          {children}
        </main>
      </div>
    </div>
  );
}
