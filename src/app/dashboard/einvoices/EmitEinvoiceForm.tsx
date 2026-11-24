'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { useTranslations } from 'next-intl';
import { emitEinvoiceAction } from '@/app/actions/einvoices';
import { Button } from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/Input';
import { actionErrorMessage, type ActionResult } from '@/lib/errors';
import type { CustomerDocType, DocType } from '@/lib/einvoice/calc';

interface ChargeOption {
  id: string;
  label: string;
  customerName: string;
  customerDni: string;
}

function SubmitButton() {
  const t = useTranslations('einvoices');
  const { pending } = useFormStatus();
  return <Button type="submit" disabled={pending}>{pending ? t('emitting') : t('emit')}</Button>;
}

function defaultDocType(docType: DocType, charge: ChargeOption): CustomerDocType {
  if (docType === 'factura') return 'ruc';
  return charge.customerDni ? 'dni' : 'none';
}

export function EmitEinvoiceForm({ charges }: { charges: ChargeOption[] }) {
  const t = useTranslations('einvoices');
  const [state, action] = useActionState<ActionResult | null, FormData>(emitEinvoiceAction, null);
  const [chargeId, setChargeId] = useState(charges[0].id);
  const charge = charges.find((option) => option.id === chargeId) ?? charges[0];
  const [docType, setDocType] = useState<DocType>('boleta');
  const [customerDocType, setCustomerDocType] = useState<CustomerDocType>(defaultDocType('boleta', charges[0]));

  function selectCharge(id: string) {
    const next = charges.find((option) => option.id === id) ?? charges[0];
    setChargeId(next.id);
    setCustomerDocType(defaultDocType(docType, next));
  }

  function selectDocType(next: DocType) {
    setDocType(next);
    setCustomerDocType(defaultDocType(next, charge));
  }

  const reason = (state?.error?.details as { reason?: string } | undefined)?.reason;
  const reasonKey = `errors.${reason}`;
  const errorMessage = state?.error && (reason ? t(reasonKey) : actionErrorMessage(state.error));

  return (
    <form action={action} key={charge.id} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <Select label={t('charge')} name="charge_id" required value={charge.id} onChange={(e) => selectCharge(e.target.value)} className="sm:col-span-2">
        {charges.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
      </Select>
      <Select label={t('docType')} name="doc_type" value={docType} onChange={(e) => selectDocType(e.target.value as DocType)}>
        <option value="boleta">{t('boleta')}</option>
        <option value="factura">{t('factura')}</option>
      </Select>
      <Select label={t('customerDocType')} name="customer_doc_type" value={customerDocType} onChange={(e) => setCustomerDocType(e.target.value as CustomerDocType)}>
        {docType === 'factura' ? <option value="ruc">{t('ruc')}</option> : (
          <>
            <option value="dni">{t('dni')}</option>
            <option value="none">{t('noDocument')}</option>
          </>
        )}
      </Select>
      {customerDocType !== 'none' && (
        <Input
          label={t('customerDocNumber')}
          name="customer_doc_number"
          required
          inputMode="numeric"
          pattern={customerDocType === 'ruc' ? '\\d{11}' : '\\d{8}'}
          defaultValue={customerDocType === 'dni' ? charge.customerDni : ''}
        />
      )}
      <Input label={t('customerName')} name="customer_name" required maxLength={200} defaultValue={charge.customerName} />
      <div className="sm:col-span-2">
        <SubmitButton />
      </div>
      {errorMessage && <p className="text-sm text-red-600 sm:col-span-2" role="alert">{errorMessage}</p>}
      {state && !state.error && <p className="text-sm text-green-700 sm:col-span-2" role="status">{t('emitted')}</p>}
    </form>
  );
}
