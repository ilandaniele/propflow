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
    supabase.from('properties').select('*, units(id, status, monthly_rent_default)').order('created_at', { ascending: false }).then(({ data }: { data: (Property & { units?: { id: string; status: string | null; monthly_rent_default?: number | null }[] })[] | null }) => {
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
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-slate-900">{property.name}</p>
                  <p className="text-sm text-slate-500">
                    {[property.address, property.city, property.country].filter(Boolean).join(', ') || t('noAddress')}
                  </p>
                  {/* Airtable-synced fields */}
                  <div className="flex flex-wrap gap-3 mt-1">
                    {(property as Record<string, unknown>).district && (
                      <span className="text-xs text-slate-400">{String((property as Record<string, unknown>).district)}</span>
                    )}
                    {(property as Record<string, unknown>).total_rooms && (
                      <span className="text-xs text-slate-400">{String((property as Record<string, unknown>).total_rooms)} {t('rooms')}</span>
                    )}
                    {(property as Record<string, unknown>).supply_number_luz && (
                      <span className="text-xs text-slate-400">⚡ #{String((property as Record<string, unknown>).supply_number_luz)}</span>
                    )}
                    {(property as Record<string, unknown>).n_suministro_agua && (
                      <span className="text-xs text-slate-400">💧 #{String((property as Record<string, unknown>).n_suministro_agua)}</span>
                    )}
                  </div>
                  {/* Unit occupancy mini-bar + monthly rent */}
                  {(() => {
                    const units = (property as Record<string, unknown>).units as { id: string; status: string | null; monthly_rent_default?: number | null }[] | undefined;
                    if (!units?.length) return null;
                    const occupied = units.filter((u) => u.status === 'occupied').length;
                    const pct = Math.round((occupied / units.length) * 100);
                    return (
                      <div className="flex items-center gap-2 mt-2">
                        <div className="flex-1 bg-slate-100 rounded-full h-1.5 max-w-24">
                          <div className="bg-green-500 h-1.5 rounded-full" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="text-xs text-slate-500">{occupied}/{units.length} {t('occupied')}</span>
                        {(() => {
                          const monthlyRent = units.filter((u) => u.status === 'occupied' && u.monthly_rent_default).reduce((s, u) => s + Number(u.monthly_rent_default ?? 0), 0);
                          return monthlyRent > 0 ? <span className="text-xs text-green-600 font-medium">S/ {monthlyRent.toLocaleString('es-PE', { minimumFractionDigits: 0 })}/mo</span> : null;
                        })()}
                      </div>
                    );
                  })()}
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
