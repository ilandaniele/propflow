import { createClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/auth/guards';
import { redirect } from 'next/navigation';
import { Card } from '@/components/ui/Card';
import { StatusPill } from '@/components/ui/Badge';
import Link from 'next/link';

interface Props {
  tenantId: string;
}

/**
 * Async Server Component — self-fetches tasks for the given tenant.
 * Wrapped in <Suspense fallback={<TabFallback />}> by the parent page so it
 * streams independently without blocking the page shell.
 */
export async function TasksTab({ tenantId }: Props) {
  let ctx;
  try { ctx = await requireAdmin(); } catch { redirect('/login'); }

  const supabase = await createClient();

  const { data } = await supabase
    .from('tenant_tasks')
    .select('id, title, task_type, status, due_at, completed_at, created_at')
    .eq('tenant_id', tenantId)
    .eq('org_id', ctx.orgId)
    .order('created_at', { ascending: false })
    .limit(50);

  const tasks = data ?? [];

  return (
    <div className="p-4">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-sm font-semibold text-slate-700">Assigned Tasks</h2>
        <Link
          href="/dashboard/tasks/new"
          className="text-xs text-brand-600 hover:text-brand-800 font-medium"
        >
          + New Task
        </Link>
      </div>
      <Card>
        {tasks.length === 0 ? (
          <p className="text-sm text-slate-400">No tasks assigned</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {tasks.map((t) => (
              <div key={t.id} className="py-3 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-slate-900">{t.title}</p>
                  <p className="text-xs text-slate-500">
                    {t.task_type} · Due: {new Date(t.due_at).toLocaleDateString()}
                  </p>
                  {t.completed_at && (
                    <p className="text-xs text-green-600">
                      Completed: {new Date(t.completed_at).toLocaleDateString()}
                    </p>
                  )}
                </div>
                <StatusPill status={t.status} />
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
