'use client';

import { useActionState, useRef, useEffect } from 'react';
import { useFormStatus } from 'react-dom';
import { useTranslations } from 'next-intl';
import { recordPayment } from '@/app/actions/payments';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Input';
import { Card, CardTitle } from '@/components/ui/Card';
import type { PaymentProofError } from '@/lib/finance/payment-proof';
import type { ActionResult } from '@/lib/errors';

const PROOF_ACCEPT = 'image/jpeg,image/png,image/webp,application/pdf';

function SubmitButton({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" loading={pending} className="w-full">
      {pending ? pendingLabel : label}
    </Button>
  );
}

function proofErrorOf(state: ActionResult): PaymentProofError | undefined {
  const details = state.error?.details as { fieldErrors?: { proof?: PaymentProofError[] } } | undefined;
  return details?.fieldErrors?.proof?.[0];
}

interface Props {
  contractId: string;
  monthlyRent: number;
}

export function RecordPaymentForm({ contractId, monthlyRent }: Props) {
  const t = useTranslations('tenantPayments.recordForm');
  const [state, action] = useActionState<ActionResult, FormData>(recordPayment, {});
  const formRef = useRef<HTMLFormElement>(null);
  const showSuccess = 'data' in state && !state.error;

  useEffect(() => {
    if (showSuccess) formRef.current?.reset();
  }, [state, showSuccess]);

  const today = new Date().toISOString().split('T')[0];
  const proofError = proofErrorOf(state);
  const proofErrorMessage = {
    empty:        t('proofEmpty'),
    too_large:    t('proofTooLarge'),
    invalid_type: t('proofInvalidType'),
  };

  return (
    <Card>
      <CardTitle className="mb-4">{t('title')}</CardTitle>
      <form ref={formRef} action={action} className="space-y-4">
        <input type="hidden" name="contract_id" value={contractId} />
        <div className="grid grid-cols-2 gap-3">
          <Input
            label={t('amount')}
            id="payment-amount"
            name="amount"
            type="number"
            min="0"
            step="0.01"
            required
            defaultValue={monthlyRent}
          />
          <Input
            label={t('paidAt')}
            id="payment-paid-at"
            name="paid_at"
            type="date"
            required
            defaultValue={today}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Select label={t('method')} id="payment-method" name="method" defaultValue="transfer">
            <option value="transfer">{t('methodTransfer')}</option>
            <option value="cash">{t('methodCash')}</option>
            <option value="card">{t('methodCard')}</option>
            <option value="other">{t('methodOther')}</option>
          </Select>
          <Input label={t('reference')} id="payment-reference" name="reference" maxLength={500} />
        </div>
        <Input label={t('period')} id="payment-period" name="period_month" type="month" />
        <Input
          label={t('proof')}
          id="payment-proof"
          name="proof"
          type="file"
          accept={PROOF_ACCEPT}
          hint={t('proofHint')}
          error={proofError ? proofErrorMessage[proofError] : undefined}
        />
        {state.error && !proofError && (
          <p role="alert" className="text-sm text-red-600">{t('error')}</p>
        )}
        {showSuccess && (
          <p className="text-sm text-green-600 font-medium" role="status">
            {t('success')}
          </p>
        )}
        <SubmitButton label={t('submit')} pendingLabel={t('submitting')} />
      </form>
    </Card>
  );
}
