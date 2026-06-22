/**
 * /dashboard/admin/import/property-mapping
 *
 * Property Mapping (AC20):
 * - Table of existing property_mappings
 * - Add new: external_name + select internal property
 * - Persist via savePropertyMapping Server Action
 */

import { redirect } from 'next/navigation';
import { requireAdmin } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { propertyMappings, properties } from '@/lib/db/schema';
import { eq, asc } from 'drizzle-orm';
import { getTranslations } from 'next-intl/server';
import { PropertyMappingForm } from './PropertyMappingForm';

export const dynamic = 'force-dynamic';

export default async function PropertyMappingPage() {
  let ctx;
  try { ctx = await requireAdmin(); } catch { redirect('/login'); }

  const t = await getTranslations('adminImport.propertyMapping');

  const [mappingRows, propertyRows] = await Promise.all([
    db
      .select({
        id:                 propertyMappings.id,
        externalName:       propertyMappings.externalName,
        internalPropertyId: propertyMappings.internalPropertyId,
        lastMatchedAt:      propertyMappings.lastMatchedAt,
      })
      .from(propertyMappings)
      .where(eq(propertyMappings.orgId, ctx.orgId))
      .orderBy(asc(propertyMappings.externalName)),
    db
      .select({ id: properties.id, name: properties.name })
      .from(properties)
      .where(eq(properties.orgId, ctx.orgId))
      .orderBy(asc(properties.name)),
  ]);

  const propList = propertyRows.map((p) => ({ id: p.id, name: p.name }));
  const propMap  = new Map<string, string>(propList.map((p) => [p.id, p.name]));

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Add new mapping */}
      <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
        <h2 className="text-base font-semibold text-slate-800">{t('addTitle')}</h2>
        <p className="text-sm text-slate-500">{t('addSubtitle')}</p>
        <PropertyMappingForm properties={propList} />
      </div>

      {/* Existing mappings table */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-800">
            {t('savedTitle')}
            <span className="ml-2 bg-slate-100 text-slate-600 text-xs font-medium px-2 py-0.5 rounded-full">
              {mappingRows.length}
            </span>
          </h2>
        </div>

        {mappingRows.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-slate-400">
            {t('emptyState')}
          </div>
        ) : (
          <table className="w-full text-sm" data-testid="property-mappings-table">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-100 text-left">
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">{t('colExternal')}</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">{t('colInternal')}</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">{t('colLastUsed')}</th>
              </tr>
            </thead>
            <tbody>
              {mappingRows.map((row) => (
                <tr key={row.id} className="border-b border-slate-50 hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-3 font-mono text-slate-700 text-sm">{row.externalName}</td>
                  <td className="px-4 py-3 text-slate-600">
                    {row.internalPropertyId
                      ? propMap.get(row.internalPropertyId) ?? row.internalPropertyId
                      : <span className="text-slate-400 italic">{t('unassigned')}</span>
                    }
                  </td>
                  <td className="px-4 py-3 text-slate-400 text-xs">
                    {row.lastMatchedAt
                      ? new Date(row.lastMatchedAt).toLocaleDateString('es-AR')
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
