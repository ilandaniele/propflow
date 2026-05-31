'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { createTenantTask } from '@/app/actions/tasks';
import { TASK_TYPES } from '@/lib/schemas/tenantTask';
import type { ActionResult } from '@/lib/errors';

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="px-4 py-2 text-sm font-medium text-white bg-brand-600 hover:bg-brand-700 rounded-lg disabled:opacity-50 transition-colors"
    >
      {pending ? 'Creating...' : 'Create Task'}
    </button>
  );
}

export default function NewTaskPage() {
  const [state, action] = useActionState<ActionResult, FormData>(createTenantTask, {});

  return (
    <div className="max-w-lg space-y-6">
      <div className="flex items-center gap-2">
        <a href="/dashboard/tasks" className="text-sm text-brand-600 hover:text-brand-800">← Back to Tasks</a>
      </div>

      <div>
        <h1 className="text-xl font-bold text-slate-900">New Task</h1>
        <p className="text-sm text-slate-500 mt-1">Create and assign a task to a tenant.</p>
      </div>

      <form action={action} className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
        <div>
          <label htmlFor="tenant_id" className="block text-sm font-medium text-slate-700 mb-1">
            Tenant ID <span className="text-red-500">*</span>
          </label>
          <input
            id="tenant_id"
            name="tenant_id"
            type="text"
            required
            placeholder="UUID of tenant"
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>

        <div>
          <label htmlFor="task_type" className="block text-sm font-medium text-slate-700 mb-1">
            Task Type <span className="text-red-500">*</span>
          </label>
          <select
            id="task_type"
            name="task_type"
            required
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"
          >
            {TASK_TYPES.map((t) => (
              <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="title" className="block text-sm font-medium text-slate-700 mb-1">
            Title <span className="text-red-500">*</span>
          </label>
          <input
            id="title"
            name="title"
            type="text"
            required
            maxLength={200}
            placeholder="e.g. Clean bathroom filter"
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>

        <div>
          <label htmlFor="description" className="block text-sm font-medium text-slate-700 mb-1">
            Description
          </label>
          <textarea
            id="description"
            name="description"
            rows={3}
            maxLength={2000}
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>

        <div>
          <label htmlFor="due_at" className="block text-sm font-medium text-slate-700 mb-1">
            Due Date <span className="text-red-500">*</span>
          </label>
          <input
            id="due_at"
            name="due_at"
            type="datetime-local"
            required
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>

        {state.error && (
          <div role="alert" className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            {state.error.message}
          </div>
        )}
        {!state.error && Object.keys(state).length > 0 && state.data !== undefined && (
          <div role="status" className="text-sm text-green-600 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
            Task created successfully.
          </div>
        )}

        <SubmitButton />
      </form>
    </div>
  );
}
