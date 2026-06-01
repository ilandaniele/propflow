import { Card } from '@/components/ui/Card';
import { StatusPill } from '@/components/ui/Badge';
import Link from 'next/link';

interface Task {
  id: string;
  title: string;
  task_type: string;
  status: string;
  due_at: string;
  completed_at?: string | null;
}

export function TasksTab({ tasks }: { tasks: Task[] }) {
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
                  <p className="text-xs text-slate-500">{t.task_type} · Due: {new Date(t.due_at).toLocaleDateString()}</p>
                  {t.completed_at && (
                    <p className="text-xs text-green-600">Completed: {new Date(t.completed_at).toLocaleDateString()}</p>
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
