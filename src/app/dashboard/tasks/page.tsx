import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { requireAdmin } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { tenantTasks, tenants } from '@/lib/db/schema';
import { eq, asc } from 'drizzle-orm';
import { getTranslations } from 'next-intl/server';
import { StatusPill } from '@/components/ui/Badge';

export const metadata: Metadata = { title: 'Tenant Tasks' };

export default async function TasksPage() {
  let ctx;
  try { ctx = await requireAdmin(); } catch { redirect('/login'); }

  const t = await getTranslations('tasks');

  const tasks = await db
    .select({
      id:            tenantTasks.id,
      title:         tenantTasks.title,
      taskType:      tenantTasks.taskType,
      status:        tenantTasks.status,
      dueAt:         tenantTasks.dueAt,
      createdAt:     tenantTasks.createdAt,
      tenantId:      tenantTasks.tenantId,
      tenantFullName: tenants.fullName,
    })
    .from(tenantTasks)
    .leftJoin(tenants, eq(tenants.id, tenantTasks.tenantId))
    .where(eq(tenantTasks.orgId, ctx.orgId))
    .orderBy(asc(tenantTasks.dueAt))
    .limit(50);

  return (
    <div className="max-w-4xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-900">{t('title')}</h1>
        <Link
          href="/dashboard/tasks/new"
          className="px-3 py-1.5 text-sm font-medium text-white bg-brand-600 hover:bg-brand-700 rounded-lg transition-colors"
        >
          + {t('newTask')}
        </Link>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
        {tasks.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-400">{t('noTasks')}</div>
        ) : (
          tasks.map((task) => (
            <div key={task.id} className="flex items-center gap-4 px-4 py-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-900">{task.title}</p>
                <p className="text-xs text-slate-500">
                  {task.taskType} ·{' '}
                  <Link href={`/dashboard/tenants/${task.tenantId}`} className="text-brand-600 hover:underline">
                    {task.tenantFullName ?? 'Unknown'}
                  </Link>
                  {' '}· {t('dueLabel')}: {new Date(task.dueAt!).toLocaleDateString()}
                </p>
              </div>
              <StatusPill status={task.status} />
            </div>
          ))
        )}
      </div>
    </div>
  );
}
