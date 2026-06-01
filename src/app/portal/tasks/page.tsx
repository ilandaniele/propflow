import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireTenant } from '@/lib/auth/guards';
import { StatusPill } from '@/components/ui/Badge';

export const metadata: Metadata = { title: 'My Tasks' };

export default async function PortalTasksPage() {
  let ctx;
  try { ctx = await requireTenant(); } catch { redirect('/login'); }

  const supabase = await createClient();

  // Find tenant row for this profile
  const { data: tenant } = await supabase
    .from('tenants')
    .select('id')
    .eq('profile_id', ctx.userId)
    .eq('org_id', ctx.orgId)
    .single();

  if (!tenant) redirect('/portal');

  const { data: tasks } = await supabase
    .from('tenant_tasks')
    .select('id, title, task_type, status, due_at, description, completed_at')
    .eq('tenant_id', tenant.id)
    .eq('org_id', ctx.orgId)
    .order('due_at', { ascending: true })
    .limit(50);

  return (
    <div className="max-w-2xl space-y-4">
      <h1 className="text-xl font-bold text-slate-900">My Tasks</h1>

      <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
        {(tasks ?? []).length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-400">No tasks assigned to you</div>
        ) : (
          (tasks ?? []).map((t) => (
            <div key={t.id} className="px-4 py-3 flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-900">{t.title}</p>
                {t.description && (
                  <p className="text-xs text-slate-600 mt-0.5">{t.description}</p>
                )}
                <p className="text-xs text-slate-400 mt-1">
                  {t.task_type} · Due: {new Date(t.due_at).toLocaleDateString()}
                </p>
                {t.completed_at && (
                  <p className="text-xs text-green-600 mt-0.5">Completed: {new Date(t.completed_at).toLocaleDateString()}</p>
                )}
              </div>
              <StatusPill status={t.status} />
            </div>
          ))
        )}
      </div>
    </div>
  );
}
