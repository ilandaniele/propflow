import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { requireTenant } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { tenants, tenantTasks } from '@/lib/db/schema';
import { eq, and, asc } from 'drizzle-orm';
import { StatusPill } from '@/components/ui/Badge';

export const metadata: Metadata = { title: 'My Tasks' };

export default async function PortalTasksPage() {
  let ctx;
  try { ctx = await requireTenant(); } catch { redirect('/login'); }

  const tenantRows = await db
    .select({ id: tenants.id })
    .from(tenants)
    .where(and(eq(tenants.profileId, ctx.userId), eq(tenants.orgId, ctx.orgId)))
    .limit(1);

  if (!tenantRows.length) redirect('/portal');

  const tenantId = tenantRows[0].id;

  const tasks = await db
    .select({
      id:          tenantTasks.id,
      title:       tenantTasks.title,
      taskType:    tenantTasks.taskType,
      status:      tenantTasks.status,
      dueAt:       tenantTasks.dueAt,
      description: tenantTasks.description,
      completedAt: tenantTasks.completedAt,
    })
    .from(tenantTasks)
    .where(and(eq(tenantTasks.tenantId, tenantId), eq(tenantTasks.orgId, ctx.orgId)))
    .orderBy(asc(tenantTasks.dueAt))
    .limit(50);

  return (
    <div className="max-w-2xl space-y-4">
      <h1 className="text-xl font-bold text-slate-900">My Tasks</h1>

      <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
        {tasks.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-400">No tasks assigned to you</div>
        ) : (
          tasks.map((task) => (
            <div key={task.id} className="px-4 py-3 flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-900">{task.title}</p>
                {task.description && (
                  <p className="text-xs text-slate-600 mt-0.5">{task.description}</p>
                )}
                <p className="text-xs text-slate-400 mt-1">
                  {task.taskType} · Due: {task.dueAt ? new Date(task.dueAt).toLocaleDateString() : '—'}
                </p>
                {task.completedAt && (
                  <p className="text-xs text-green-600 mt-0.5">
                    Completed: {new Date(task.completedAt).toLocaleDateString()}
                  </p>
                )}
              </div>
              <StatusPill status={task.status} />
            </div>
          ))
        )}
      </div>
    </div>
  );
}
