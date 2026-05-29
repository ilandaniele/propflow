'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { createCharge } from '@/app/actions/payments';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Input';
import type { ActionResult } from '@/lib/errors';

function SubmitButton() {
  const { pending } = useFormStatus();
  return <Button type="submit" loading={pending} size="sm">Create Charge</Button>;
}

interface Contract {
  id: string;
  monthly_rent: number;
  tenant_id: string;
  tenants: { full_name: string } | null;
}

export function CreateChargeForm({ contracts }: { contracts: Contract[] }) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState<ActionResult, FormData>(createCharge, {});

  if (state.data !== undefined && open) setOpen(false);

  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>Add Charge</Button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50" role="dialog" aria-modal="true" aria-label="Create charge">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6">
            <h2 className="text-base font-semibold text-slate-900 mb-4">New Charge</h2>
            <form action={action} className="space-y-4">
              <Select label="Contract" name="contract_id" required>
                <option value="">Select contract</option>
                {contracts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.tenants?.full_name ?? 'Unknown'} — ${c.monthly_rent}/mo
                  </option>
                ))}
              </Select>
              <input type="hidden" name="tenant_id" value="" />
              <Input label="Description" name="description" required placeholder="e.g. Rent - June 2025" />
              <Input label="Amount ($)" name="amount" type="number" min="0" step="0.01" required />
              <div className="grid grid-cols-2 gap-3">
                <Input label="Period" name="period" type="date" />
                <Input label="Due Date" name="due_date" type="date" />
              </div>
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
