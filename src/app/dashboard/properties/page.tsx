import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { requireAdmin } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { properties, units } from '@/lib/db/schema';
import { eq, desc } from 'drizzle-orm';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { AddPropertyButton } from './AddPropertyButton';

export const metadata: Metadata = { title: 'Properties' };

export default async function PropertiesPage() {
  let ctx;
  try { ctx = await requireAdmin(); } catch { redirect('/login'); }

  const [rows, t] = await Promise.all([
    db
      .select({
        id:      properties.id,
        name:    properties.name,
        address: properties.address,
        city:    properties.city,
        country: properties.country,
      })
      .from(properties)
      .where(eq(properties.orgId, ctx.orgId))
      .orderBy(desc(properties.createdAt)),
    getTranslations('properties'),
  ]);

  // Fetch all units for these properties in one query
  const propertyIds = rows.map(p => p.id);
  const allUnits = propertyIds.length > 0
    ? await db
        .select({
          id:                 units.id,
          propertyId:         units.propertyId,
          status:             units.status,
          monthlyRentDefault: units.monthlyRentDefault,
        })
        .from(units)
        .where(eq(units.orgId, ctx.orgId))
    : [];

  const unitsByProperty: Record<string, typeof allUnits> = {};
  for (const u of allUnits) {
    if (!unitsByProperty[u.propertyId]) unitsByProperty[u.propertyId] = [];
    unitsByProperty[u.propertyId].push(u);
  }

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
            const propUnits = unitsByProperty[property.id] ?? [];
            const occupied = propUnits.filter((u) => u.status === 'occupied').length;
            const pct = propUnits.length ? Math.round((occupied / propUnits.length) * 100) : 0;
            const monthlyRent = propUnits
              .filter((u) => u.status === 'occupied' && u.monthlyRentDefault)
              .reduce((s, u) => s + Number(u.monthlyRentDefault ?? 0), 0);

            return (
              <Card key={property.id} padding="sm">
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-slate-900">{property.name}</p>
                    <p className="text-sm text-slate-500">
                      {[property.address, property.city, property.country].filter(Boolean).join(', ') || t('noAddress')}
                    </p>
                    {propUnits.length > 0 && (
                      <div className="flex items-center gap-2 mt-2">
                        <div className="flex-1 bg-slate-100 rounded-full h-1.5 max-w-24">
                          <div className="bg-green-500 h-1.5 rounded-full" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="text-xs text-slate-500">{occupied}/{propUnits.length} {t('occupied')}</span>
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
