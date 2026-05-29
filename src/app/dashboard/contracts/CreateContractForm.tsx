'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { createContract } from '@/app/actions/contracts';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Input';
import type { ActionResult } from '@/lib/errors';

function SubmitButton() {
  const { pending } = useFormStatus();
  return <Button type="submit" loading={pending} size="sm">Create</Button>;
}

interface Props {
  tenants: Array<{ id: string; full_name: string }>;
  units: Array<{ id: string; label: string; property_id: string; properties: { name: string } | null }>;
}

export function CreateContractForm({ tenants, units }: Props) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState<ActionResult, FormData>(createContract, {});

  if (state.data !== undefined && open) setOpen(false);

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>New Contract</Button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50" role="dialog" aria-modal="true" aria-label="Create contract">
          <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full p-6 max-h-[90vh] overflow-y-auto">
            <h2 className="text-base font-semibold text-slate-900 mb-4">New Contract</h2>
            <form action={action} className="space-y-4">
              <Select label="Tenant" name="tenant_id" required>
                <option value="">Select tenant</option>
                {tenants.map((t) => <option key={t.id} value={t.id}>{t.full_name}</option>)}
              </Select>
              <Select label="Unit" name="unit_id" required>
                <option value="">Select unit</option>
                {units.map((u) => <option key={u.id} value={u.id}>{u.properties?.name} — {u.label}</option>)}
              </Select>
              <div className="grid grid-cols-2 gap-3">
                <Input label="Start Date" name="start_date" type="date" required />
                <Input label="End Date" name="end_date" type="date" required />
              </div>
              <Input label="Monthly Rent ($)" name="monthly_rent" type="number" min="0" step="0.01" required placeholder="1500" />
              <Input label="Deposit ($)" name="deposit" type="number" min="0" step="0.01" placeholder="3000" />
              {state.error && (
                <p role="alert" className="text-sm text-red-600">{state.error.message}</p>
              )}
              <div className="flex gap-2 pt-1">
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
