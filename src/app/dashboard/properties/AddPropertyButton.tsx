'use client';

import { useActionState, useState } from 'react';
import { useTranslations } from 'next-intl';
import { createProperty } from '@/app/actions/properties';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import type { ActionResult } from '@/lib/errors';

export function AddPropertyButton() {
  const t = useTranslations('properties');
  const tc = useTranslations('common');
  const [showForm, setShowForm] = useState(false);
  const [state, action] = useActionState<ActionResult, FormData>(createProperty, {});

  return (
    <>
      <Button onClick={() => setShowForm(true)} size="sm">{t('addButton')}</Button>

      {showForm && (
        <Card>
          <h2 className="text-base font-semibold text-slate-900 mb-4">{t('newFormTitle')}</h2>
          <form action={action} className="space-y-4">
            <Input label={t('fieldName')} name="name" required placeholder="e.g. Oak Street Complex" />
            <Input label={t('fieldAddress')} name="address" placeholder="123 Oak Street" />
            <div className="grid grid-cols-2 gap-3">
              <Input label={t('fieldCity')} name="city" placeholder="Lima" />
              <Input label={t('fieldCountry')} name="country" placeholder="PE" />
            </div>
            {state.error && (
              <p role="alert" className="text-sm text-red-600">{state.error.message}</p>
            )}
            <div className="flex gap-2">
              <Button type="submit" size="sm">{t('createButton')}</Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setShowForm(false)}>{tc('cancel')}</Button>
            </div>
          </form>
        </Card>
      )}
    </>
  );
}
