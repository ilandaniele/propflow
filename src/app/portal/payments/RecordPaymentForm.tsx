'use client';

import { useActionState, useRef, useEffect } from 'react';
import { useFormStatus } from 'react-dom';
import { recordPayment } from '@/app/actions/payments';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Input';
import { Card, CardTitle } from '@/components/ui/Card';
import type { ActionResult } from '@/lib/errors';

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" loading={pending} className="w-full">
      {pending ? 'Recording...' : 'Record Payment'}
    </Button>
  );
}

interface Props {
  contractId: string;
  monthlyRent: number;
}

export function RecordPaymentForm({ contractId, monthlyRent }: Props) {
  const [state, action] = useActionState<ActionResult, FormData>(recordPayment, {});
  const formRef = useRef<HTMLFormElement>(null);
  const prevDataRef = useRef<unknown>(null);

  useEffect(() => {
    if (state.data !== undefined && state.data !== prevDataRef.current) {
      prevDataRef.current = state.data;
      formRef.current?.reset();
    }
  }, [state.data]);

  const today = new Date().toISOString().split('T')[0];
  const showSuccess = state.data !== undefined;

  return (
    <Card>
      <CardTitle className="mb-4">Record a Payment</CardTitle>
      <form ref={formRef} action={action} className="space-y-4">
        <input type="hidden" name="contract_id" value={contractId} />
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Amount ($)"
            name="amount"
            type="number"
            min="0"
            step="0.01"
            required
            defaultValue={monthlyRent}
          />
          <Input
            label="Date Paid"
            name="paid_at"
            type="date"
            required
            defaultValue={today}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Select label="Method" name="method" defaultValue="transfer">
            <option value="transfer">Bank Transfer</option>
            <option value="cash">Cash</option>
            <option value="card">Card</option>
            <option value="other">Other</option>
          </Select>
          <Input label="Reference (optional)" name="reference" placeholder="TXN-123" />
        </div>
        {state.error && (
          <p role="alert" className="text-sm text-red-600">{state.error.message}</p>
        )}
        {showSuccess && (
          <p className="text-sm text-green-600 font-medium" role="status">
            Payment recorded — pending approval
          </p>
        )}
        <SubmitButton />
      </form>
    </Card>
  );
}
