'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { addInternalNote } from '@/app/actions/tenants';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import type { ActionResult } from '@/lib/errors';

interface Note {
  id: string;
  content: string;
  created_by: string;
  created_at: string;
}

interface NotesTabProps {
  notes: Note[];
  tenantId: string;
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="px-4 py-2 text-sm font-medium text-white bg-brand-600 hover:bg-brand-700 rounded-lg disabled:opacity-50 transition-colors"
    >
      {pending ? 'Adding...' : 'Add Note'}
    </button>
  );
}

export function NotesTab({ notes, tenantId }: NotesTabProps) {
  const [state, action] = useActionState<ActionResult, FormData>(addInternalNote, {});

  return (
    <div className="p-4 space-y-4">
      {/* Add note form */}
      <Card>
        <CardHeader><CardTitle>Add Internal Note</CardTitle></CardHeader>
        <form action={action} className="space-y-3">
          <input type="hidden" name="tenant_id" value={tenantId} />
          <textarea
            name="content"
            required
            rows={3}
            placeholder="Write an internal note about this tenant..."
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
          {state.error && (
            <p className="text-xs text-red-600">{state.error.message}</p>
          )}
          <SubmitButton />
        </form>
      </Card>

      {/* Existing notes */}
      <Card>
        <CardHeader><CardTitle>Internal Notes</CardTitle></CardHeader>
        {notes.length === 0 ? (
          <p className="text-sm text-slate-400">No internal notes yet</p>
        ) : (
          <div className="space-y-3">
            {notes.map((n) => (
              <div key={n.id} className="border border-slate-100 rounded-lg p-3">
                <p className="text-sm text-slate-800 whitespace-pre-wrap">{n.content}</p>
                <p className="text-xs text-slate-400 mt-2">{new Date(n.created_at).toLocaleString()}</p>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
