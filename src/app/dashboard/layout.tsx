import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { AdminSidebar } from '@/components/shell/AdminSidebar';
import { AdminTopbar } from '@/components/shell/AdminTopbar';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, full_name, org_id')
    .eq('id', user.id)
    .single();

  if (!profile || profile.role !== 'admin') {
    redirect('/portal');
  }

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
