import { requireAdmin } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { tenantTasks } from '@/lib/db/schema';
import { eq, and, desc } from 'drizzle-orm';
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

  const [rows, t] = await Promise.all([
    db
      .select({
        id:          tenantTasks.id,
        title:       tenantTasks.title,
        taskType:    tenantTasks.taskType,
        status:      tenantTasks.status,
        dueAt:       tenantTasks.dueAt,
        completedAt: tenantTasks.completedAt,
      })
      .from(tenantTasks)
      .where(and(eq(tenantTasks.tenantId, tenantId), eq(tenantTasks.orgId, ctx.orgId)))
      .orderBy(desc(tenantTasks.createdAt))
      .limit(50),
    getTranslations('tasksTab'),
  ]);

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
        {rows.length === 0 ? (
          <p className="text-sm text-slate-400">{t('empty')}</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {rows.map((task) => (
              <div key={task.id} className="py-3 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-slate-900">{task.title}</p>
                  <p className="text-xs text-slate-500">
                    {task.taskType} · {t('due')} {task.dueAt ? new Date(task.dueAt).toLocaleDateString() : '—'}
                  </p>
                  {task.completedAt && (
                    <p className="text-xs text-green-600">
                      {t('completed')} {new Date(task.completedAt).toLocaleDateString()}
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
