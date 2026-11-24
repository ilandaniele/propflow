import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { requireAdmin } from '@/lib/auth/guards';
import { listAmenities, orgPropertyOptions } from '@/lib/amenities/amenities';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Badge } from '@/components/ui/Badge';
import { AmenityForm } from './AmenityForm';
import { AmenityActiveToggle } from './AmenityActiveToggle';

export const metadata: Metadata = { title: 'Common areas' };

export default async function AmenitiesPage() {
  let ctx;
  try { ctx = await requireAdmin(); } catch { redirect('/login'); }
  const t = await getTranslations('amenities');
  const [rows, propertyOptions] = await Promise.all([listAmenities(ctx.orgId), orgPropertyOptions(ctx.orgId)]);

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">{t('title')}</h1>
        <p className="text-sm text-slate-500 mt-1">{t('subtitle')}</p>
      </div>

      {propertyOptions.length > 0 && <AmenityForm properties={propertyOptions} />}

      {rows.length === 0 ? (
        <Card><EmptyState title={t('emptyTitle')} description={t('emptyDesc')} /></Card>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
          <table className="w-full text-sm" aria-label={t('title')}>
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                <th className="text-left px-4 py-3">{t('colName')}</th>
                <th className="text-left px-4 py-3">{t('colProperty')}</th>
                <th className="text-left px-4 py-3">{t('colHours')}</th>
                <th className="text-right px-4 py-3">{t('colSlot')}</th>
                <th className="text-right px-4 py-3"><span className="sr-only">{t('colActions')}</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((row) => (
                <tr key={row.id}>
                  <td className="px-4 py-3 font-medium text-slate-900">
                    <Link href={`/dashboard/amenities/${row.id}`} className="hover:underline">{row.name}</Link>
                    {!row.active && <Badge variant="default" className="ml-2">{t('inactive')}</Badge>}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{row.propertyName}</td>
                  <td className="px-4 py-3 tabular-nums text-slate-600">{row.openTime}–{row.closeTime}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-600">{t('minutes', { count: row.slotMinutes })}</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <Link href={`/dashboard/amenities/${row.id}`} className="mr-2 text-sm font-medium text-slate-700 hover:underline">{t('viewSchedule')}</Link>
                    <AmenityActiveToggle amenityId={row.id} active={row.active} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
