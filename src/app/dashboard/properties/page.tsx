import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { createAdminServerClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/auth/guards';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { AddPropertyButton } from './AddPropertyButton';

export const metadata: Metadata = { title: 'Properties' };

export default async function PropertiesPage() {
  let ctx;
  try { ctx = await requireAdmin(); } catch { redirect('/login'); }

  const [supabase, t] = await Promise.all([
    createAdminServerClient(),
    getTranslations('properties'),
  ]);

  const { data: properties } = await supabase
    .from('properties')
    .select('*, units(id, status, monthly_rent_default)')
    .eq('org_id', ctx.orgId)
    .order('created_at', { ascending: false });

  const rows = properties ?? [];
  const countLabel = `${rows.length} ${rows.length === 1 ? t('singular') : t('plural')}`;

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{t('title')}</h1>
          <p className="text-sm text-slate-500 mt-1">{countLabel}</p>
        </div>
        <AddPropertyButton />
      </div>

      {rows.length === 0 ? (
        <Card>
          <EmptyState title={t('emptyTitle')} description={t('emptyDesc')} />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3">
          {rows.map((property) => {
            const units = (property.units ?? []) as { id: string; status: string | null; monthly_rent_default?: number | null }[];
            const occupied = units.filter((u) => u.status === 'occupied').length;
            const pct = units.length ? Math.round((occupied / units.length) * 100) : 0;
            const monthlyRent = units
              .filter((u) => u.status === 'occupied' && u.monthly_rent_default)
              .reduce((s, u) => s + Number(u.monthly_rent_default ?? 0), 0);

            return (
              <Card key={property.id} padding="sm">
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-slate-900">{property.name}</p>
                    <p className="text-sm text-slate-500">
                      {[property.address, property.city, property.country].filter(Boolean).join(', ') || t('noAddress')}
                    </p>
                    <div className="flex flex-wrap gap-3 mt-1">
                      {property.district && (
                        <span className="text-xs text-slate-400">{property.district}</span>
                      )}
                      {property.total_rooms && (
                        <span className="text-xs text-slate-400">{property.total_rooms} {t('rooms')}</span>
                      )}
                      {property.supply_number_luz && (
                        <span className="text-xs text-slate-400">⚡ #{property.supply_number_luz}</span>
                      )}
                      {property.n_suministro_agua && (
                        <span className="text-xs text-slate-400">💧 #{property.n_suministro_agua}</span>
                      )}
                    </div>
                    {units.length > 0 && (
                      <div className="flex items-center gap-2 mt-2">
                        <div className="flex-1 bg-slate-100 rounded-full h-1.5 max-w-24">
                          <div className="bg-green-500 h-1.5 rounded-full" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="text-xs text-slate-500">{occupied}/{units.length} {t('occupied')}</span>
                        {monthlyRent > 0 && (
                          <span className="text-xs text-green-600 font-medium">
                            S/ {monthlyRent.toLocaleString('es-PE', { minimumFractionDigits: 0 })}/mo
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                  <a href={`/dashboard/units?property=${property.id}`}>
                    <button className="text-sm text-slate-500 hover:text-slate-900 px-3 py-1.5 rounded-lg hover:bg-slate-100 transition-colors">
                      {t('viewUnits')}
                    </button>
                  </a>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
