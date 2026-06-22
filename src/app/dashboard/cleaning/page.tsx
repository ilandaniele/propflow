import { requireAdmin } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { cleaningTasks } from '@/lib/db/schema';
import { eq, asc } from 'drizzle-orm';
import { getTranslations } from 'next-intl/server';
import { EmptyState } from '@/components/ui/EmptyState';
import { Card } from '@/components/ui/Card';
import { CreateCleaningTaskForm } from './CreateCleaningTaskForm';

export default async function CleaningPage() {
  const ctx = await requireAdmin();
  const t = await getTranslations('cleaning');

  const tasks = await db
    .select({
      id:            cleaningTasks.id,
      title:         cleaningTasks.title,
      scheduledDate: cleaningTasks.scheduledDate,
      status:        cleaningTasks.status,
      notes:         cleaningTasks.notes,
      unitId:        cleaningTasks.unitId,
    })
    .from(cleaningTasks)
    .where(eq(cleaningTasks.orgId, ctx.orgId))
    .orderBy(asc(cleaningTasks.scheduledDate))
    .limit(50);

  const grouped = {
    pending:     tasks.filter(t => t.status === 'pending'),
    in_progress: tasks.filter(t => t.status === 'in_progress'),
    done:        tasks.filter(t => t.status === 'done'),
  };

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-semibold text-slate-900">{t('title')}</h1>

      <Card padding="md">
        <h2 className="text-base font-medium text-slate-800 mb-4">{t('newTask')}</h2>
        <CreateCleaningTaskForm />
      </Card>

      {tasks.length === 0 ? (
        <EmptyState title={t('emptyTitle')} description={t('emptyDesc')} />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {(['pending', 'in_progress', 'done'] as const).map(status => (
            <div key={status}>
              <h3 className="text-sm font-semibold text-slate-600 mb-2 capitalize">
                {status === 'pending' ? t('statusPending') : status === 'in_progress' ? t('statusInProgress') : t('statusDone')} ({grouped[status].length})
              </h3>
              <div className="space-y-2">
                {grouped[status].map(task => (
                  <div key={task.id} className="border border-slate-200 rounded-lg p-3 bg-white text-sm">
                    <p className="font-medium text-slate-900">{task.title}</p>
                    <p className="text-xs text-slate-500 mt-1">{task.scheduledDate}</p>
                    {task.notes && <p className="text-xs text-slate-400 mt-0.5">{task.notes}</p>}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
