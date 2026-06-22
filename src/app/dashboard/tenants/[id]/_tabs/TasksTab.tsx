import { createAdminServerClient as createClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/auth/guards';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
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

  const [supabase, t] = await Promise.all([createClient(), getTranslations('tasksTab')]);

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
        <h2 className="text-sm font-semibold text-slate-700">{t('title')}</h2>
        <Link
          href="/dashboard/tasks/new"
          className="text-xs text-brand-600 hover:text-brand-800 font-medium"
        >
          {t('newTask')}
        </Link>
      </div>
      <Card>
        {tasks.length === 0 ? (
          <p className="text-sm text-slate-400">{t('empty')}</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {tasks.map((task) => (
              <div key={task.id} className="py-3 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-slate-900">{task.title}</p>
                  <p className="text-xs text-slate-500">
                    {task.task_type} · {t('due')} {new Date(task.due_at).toLocaleDateString()}
                  </p>
                  {task.completed_at && (
                    <p className="text-xs text-green-600">
                      {t('completed')} {new Date(task.completed_at).toLocaleDateString()}
                    </p>
                  )}
                </div>
                <StatusPill status={task.status} />
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
