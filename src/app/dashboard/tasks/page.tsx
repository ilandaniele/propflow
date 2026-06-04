import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/auth/guards';
import { StatusPill } from '@/components/ui/Badge';

export const metadata: Metadata = { title: 'Tenant Tasks' };

export default async function TasksPage() {
  let ctx;
  try { ctx = await requireAdmin(); } catch { redirect('/login'); }

  const supabase = await createClient();

  const { data: tasks } = await supabase
    .from('tenant_tasks')
    .select(`
      id, title, task_type, status, due_at, created_at,
      tenant:tenants(id, full_name)
    `)
    .eq('org_id', ctx.orgId)
    .order('due_at', { ascending: true })
    .limit(50);

  return (
    <div className="max-w-4xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-900">Tenant Tasks</h1>
        <Link
          href="/dashboard/tasks/new"
          className="px-3 py-1.5 text-sm font-medium text-white bg-brand-600 hover:bg-brand-700 rounded-lg transition-colors"
        >
          + New Task
        </Link>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
        {(tasks ?? []).length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-400">No tasks yet</div>
        ) : (
          (tasks ?? []).map((t) => {
            const tenant = t.tenant as unknown as { id: string; full_name: string | null } | null;
            return (
              <div key={t.id} className="flex items-center gap-4 px-4 py-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-900">{t.title}</p>
                  <p className="text-xs text-slate-500">
                    {t.task_type} ·{' '}
                    <Link href={`/dashboard/tenants/${tenant?.id}`} className="text-brand-600 hover:underline">
                      {tenant?.full_name ?? 'Unknown'}
                    </Link>
                    {' '}· Due: {new Date(t.due_at).toLocaleDateString()}
                  </p>
                </div>
                <StatusPill status={t.status} />
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
