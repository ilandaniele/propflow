import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getProfile } from '@/lib/auth/guards';
import { AdminSidebar } from '@/components/shell/AdminSidebar';
import { AdminTopbar } from '@/components/shell/AdminTopbar';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  // getProfile() is wrapped in React.cache() — if a dashboard page calls
  // requireAdmin() (which calls requireUser() → getProfile()), these two calls
  // share the same cached result and only one profiles SELECT is issued.
  const profile = await getProfile();

  if (!profile || profile.role !== 'admin') {
    redirect('/login');
  }

  // Organization name is only needed by the layout shell; no other consumer
  // requests it, so it is NOT cached (one dedicated SELECT per request is fine).
  const supabase = await createClient();
  const { data: org } = await supabase
    .from('organizations')
    .select('name')
    .eq('id', profile.org_id)
    .single();

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50">
      <AdminSidebar orgName={org?.name} />
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        <AdminTopbar userName={profile.full_name} />
        <main className="flex-1 overflow-y-auto p-6" id="main-content">
          {children}
        </main>
      </div>
    </div>
  );
}
