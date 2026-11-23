'use client';

import { useActionState, useEffect, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { convertLeadToTenant } from '@/app/actions/lead-conversion';
import { Button } from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/Input';
import { actionErrorMessage, type ActionResult } from '@/lib/errors';

interface UnitOption {
  id: string;
  label: string;
  occupied: boolean;
  monthlyRentDefault: string;
}

interface ConvertLeadFormProps {
  lead: { id: string; fullName: string; email: string; phone: string };
  units: UnitOption[];
  startDate: string;
  endDate: string;
}

function SubmitButton() {
  const t = useTranslations('leadConversion');
  const { pending } = useFormStatus();
  return <Button type="submit" disabled={pending}>{pending ? t('saving') : t('submit')}</Button>;
}

export function ConvertLeadForm({ lead, units, startDate, endDate }: ConvertLeadFormProps) {
  const t = useTranslations('leadConversion');
  const router = useRouter();
  const [state, action] = useActionState<ActionResult<{ tenantId: string }> | null, FormData>(convertLeadToTenant, null);
  const firstVacant = units.find((unit) => !unit.occupied) ?? units[0];
  const [unitId, setUnitId] = useState(firstVacant.id);
  const [rent, setRent] = useState(firstVacant.monthlyRentDefault);

  useEffect(() => {
    if (state?.data) router.push(`/dashboard/tenants/${state.data.tenantId}`);
  }, [state, router]);

  function selectUnit(id: string) {
    setUnitId(id);
    const unit = units.find((option) => option.id === id);
    if (unit?.monthlyRentDefault) setRent(unit.monthlyRentDefault);
  }

  return (
    <form action={action} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <input type="hidden" name="lead_id" value={lead.id} />
      <Input label={t('fullName')} name="full_name" required defaultValue={lead.fullName} className="sm:col-span-2" />
      <Input label={t('email')} name="email" type="email" defaultValue={lead.email} />
      <Input label={t('phone')} name="phone" defaultValue={lead.phone} />
      <Select label={t('unit')} name="unit_id" required value={unitId} onChange={(e) => selectUnit(e.target.value)} className="sm:col-span-2">
        {units.map((unit) => (
          <option key={unit.id} value={unit.id}>
            {unit.occupied ? `${unit.label} (${t('occupied')})` : unit.label}
          </option>
        ))}
      </Select>
      <Input label={t('startDate')} name="start_date" type="date" required defaultValue={startDate} />
      <Input label={t('endDate')} name="end_date" type="date" required defaultValue={endDate} />
      <Input label={t('monthlyRent')} name="monthly_rent" type="number" min="0" step="0.01" required value={rent} onChange={(e) => setRent(e.target.value)} />
      <Input label={t('deposit')} name="deposit" type="number" min="0" step="0.01" />
      <div className="sm:col-span-2">
        <SubmitButton />
      </div>
      {state?.error && <p className="text-sm text-red-600 sm:col-span-2" role="alert">{actionErrorMessage(state.error)}</p>}
    </form>
  );
}
