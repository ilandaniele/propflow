'use client';

import { useActionState, useState } from 'react';
import { useTranslations } from 'next-intl';
import { createProperty } from '@/app/actions/properties';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import type { ActionResult } from '@/lib/errors';

export function CreatePropertyFormWrapper() {
  const t = useTranslations('createProperty');
  const [showForm, setShowForm] = useState(false);
  const [state, action] = useActionState<ActionResult, FormData>(createProperty, {});

  return (
    <>
      <Button onClick={() => setShowForm(true)} size="sm">{t('openButton')}</Button>
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
          <Card className="w-full max-w-md mx-4">
            <h2 className="text-base font-semibold text-slate-900 mb-4">{t('modalTitle')}</h2>
            <form action={action} className="space-y-4">
              <Input label={t('nameLabel')} name="name" required placeholder={t('namePlaceholder')} />
              <Input label={t('addressLabel')} name="address" placeholder={t('addressPlaceholder')} />
              <div className="grid grid-cols-2 gap-3">
                <Input label={t('cityLabel')} name="city" placeholder={t('cityPlaceholder')} />
                <Input label={t('countryLabel')} name="country" placeholder={t('countryPlaceholder')} />
              </div>
              {state.error && (
                <p role="alert" className="text-sm text-red-600">{state.error.message}</p>
              )}
              <div className="flex gap-2">
                <Button type="submit" size="sm">{t('submit')}</Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => setShowForm(false)}>{t('cancel')}</Button>
              </div>
            </form>
          </Card>
        </div>
      )}
    </>
  );
}
