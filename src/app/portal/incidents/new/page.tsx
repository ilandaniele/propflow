'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import Link from 'next/link';
import { createIncident } from '@/app/actions/incidents';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Textarea, Select } from '@/components/ui/Input';
import { Card } from '@/components/ui/Card';
import type { ActionResult } from '@/lib/errors';

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" loading={pending} className="w-full">
      {pending ? 'Submitting...' : 'Submit Incident'}
    </Button>
  );
}

export default function NewIncidentPage() {
  const [state, action] = useActionState<ActionResult, FormData>(createIncident, {});

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <Link href="/portal/incidents" className="text-sm text-slate-500 hover:text-slate-900">
          ← Back
        </Link>
        <h1 className="text-xl font-bold text-slate-900">Report an Issue</h1>
      </div>

      <Card>
        <form action={action} encType="multipart/form-data" className="space-y-4">
          <Input label="Title" name="title" required placeholder="e.g. Leaking faucet in bathroom" />

          <div className="grid grid-cols-2 gap-3">
            <Select label="Category" name="category" required defaultValue="other">
              <option value="plumbing">Plumbing</option>
              <option value="electrical">Electrical</option>
              <option value="appliance">Appliance</option>
              <option value="structural">Structural</option>
              <option value="cleaning">Cleaning</option>
              <option value="other">Other</option>
            </Select>
            <Select label="Priority" name="priority" defaultValue="medium">
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </Select>
          </div>

          <Textarea
            label="Description"
            name="description"
            required
            rows={5}
            placeholder="Describe the issue in detail — what happened, when you noticed it, how severe it is..."
          />

          <div>
            <label htmlFor="photo" className="block text-sm font-medium text-slate-700 mb-1">
              Photo (optional — max 5 MB, PNG/JPEG/WebP)
            </label>
            <input
              id="photo"
              name="photo"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="w-full text-sm text-slate-500 file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:text-xs file:font-medium file:bg-slate-100 file:text-slate-700 hover:file:bg-slate-200 cursor-pointer"
            />
          </div>

          {state.error && (
            <div role="alert" className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
              {state.error.message}
            </div>
          )}

          <SubmitButton />
        </form>
      </Card>
    </div>
  );
}
