'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { createUnit } from '@/app/actions/properties';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Input';
import type { ActionResult } from '@/lib/errors';

function SubmitButton() {
  const { pending } = useFormStatus();
  return <Button type="submit" loading={pending} size="sm">Create</Button>;
}

export function CreateUnitForm({ properties }: { properties: Array<{ id: string; name: string }> }) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState<ActionResult, FormData>(createUnit, {});

  if (state.data !== undefined && open) setOpen(false);

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>Add Unit</Button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50" role="dialog" aria-modal="true" aria-label="Create unit">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6">
            <h2 className="text-base font-semibold text-slate-900 mb-4">New Unit</h2>
            <form action={action} className="space-y-4">
              <Select label="Property" name="property_id" required>
                <option value="">Select property</option>
                {properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
              <Input label="Unit Label" name="label" required placeholder="e.g. Apt 3B" />
              <div className="grid grid-cols-2 gap-3">
                <Input label="Floor" name="floor" placeholder="2" />
                <Input label="Bedrooms" name="bedrooms" type="number" min="0" placeholder="2" />
              </div>
              <Input label="Default Monthly Rent ($)" name="monthly_rent_default" type="number" min="0" step="0.01" placeholder="1500" />
              {state.error && <p role="alert" className="text-sm text-red-600">{state.error.message}</p>}
              <div className="flex gap-2">
                <SubmitButton />
                <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
