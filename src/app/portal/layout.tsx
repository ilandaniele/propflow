import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { TenantNav } from '@/components/shell/TenantNav';

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, full_name')
    .eq('id', user.id)
    .single();

  if (!profile || profile.role !== 'tenant') {
    redirect('/dashboard');
  }

  return (
    <div className="min-h-screen flex flex-col bg-slate-50">
      <TenantNav userName={profile.full_name} />
      <main className="flex-1 max-w-2xl mx-auto w-full px-4 py-6 pb-20 sm:pb-6" id="main-content">
        {children}
      </main>
    </div>
  );
}
