'use client';

import { useActionState } from 'react';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/client';
import type { Property } from '@/types';
import { createProperty } from '@/app/actions/properties';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { EmptyState } from '@/components/ui/EmptyState';
import type { ActionResult } from '@/lib/errors';

export default function PropertiesPage() {
  const t = useTranslations('properties');
  const tc = useTranslations('common');
  const [properties, setProperties] = useState<Property[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [state, action] = useActionState<ActionResult, FormData>(createProperty, {});

  useEffect(() => {
    const supabase = createClient();
    supabase.from('properties').select('*').order('created_at', { ascending: false }).then(({ data }: { data: Property[] | null }) => {
      setProperties(data ?? []);
      setLoading(false);
    });
  }, [state]);

  useEffect(() => {
    if (state.data !== undefined) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setShowForm(false);
    }
  }, [state]);

  const countLabel = `${properties.length} ${properties.length === 1 ? t('singular') : t('plural')}`;

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{t('title')}</h1>
          <p className="text-sm text-slate-500 mt-1">{countLabel}</p>
        </div>
        <Button onClick={() => setShowForm(true)} size="sm">{t('addButton')}</Button>
      </div>

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

      {loading ? (
        <div className="space-y-3">
          {[1,2,3].map(i => <div key={i} className="h-20 bg-slate-100 rounded-xl animate-pulse" />)}
        </div>
      ) : properties.length === 0 ? (
        <Card>
          <EmptyState
            title={t('emptyTitle')}
            description={t('emptyDesc')}
            action={{ label: t('addButton'), onClick: () => setShowForm(true) }}
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3">
          {properties.map((property) => (
            <Card key={property.id} padding="sm">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-semibold text-slate-900">{property.name}</p>
                  <p className="text-sm text-slate-500">
                    {[property.address, property.city, property.country].filter(Boolean).join(', ') || t('noAddress')}
                  </p>
                </div>
                <a href={`/dashboard/units?property=${property.id}`}>
                  <Button variant="ghost" size="sm">{t('viewUnits')}</Button>
                </a>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
