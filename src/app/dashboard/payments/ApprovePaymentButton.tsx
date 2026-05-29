'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { approvePayment } from '@/app/actions/payments';
import { Button } from '@/components/ui/Button';
import type { ActionResult } from '@/lib/errors';

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" variant="secondary" loading={pending}>
      {pending ? '...' : 'Approve'}
    </Button>
  );
}

export function ApprovePaymentButton({ paymentId }: { paymentId: string }) {
  const [state, action] = useActionState<ActionResult, FormData>(approvePayment, {});

  return (
    <form action={action}>
      <input type="hidden" name="payment_id" value={paymentId} />
      <SubmitButton />
      {state.error && (
        <span className="text-xs text-red-600 ml-2">{state.error.message}</span>
      )}
    </form>
  );
}
