import { Suspense } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { requireAdmin } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { units as unitsTable, properties, tenants } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { StatusPill } from '@/components/ui/Badge';
import { Avatar } from '@/components/ui/Avatar';
import { Tabs } from '@/components/ui/Tabs';
import { TabFallback } from '@/components/ui/TabFallback';
import { ImagesTab } from './_tabs/ImagesTab';
import { getUnitImagesAdmin } from '@/app/actions/unit-images';

export const metadata: Metadata = { title: 'Unit Details' };

interface Props {
  params: Promise<{ id: string }>;
}

export default async function UnitDetailPage({ params }: Props) {
  const { id } = await params;

  let ctx;
  try { ctx = await requireAdmin(); } catch { redirect('/login'); }

  const t = await getTranslations('units');

  // Fetch unit scoped to org — notFound() if missing or from another org (IDOR guard)
  const unitRows = await db
    .select({
      id:                 unitsTable.id,
      label:              unitsTable.label,
      floor:              unitsTable.floor,
      status:             unitsTable.status,
      toiletType:         unitsTable.toiletType,
      areaM2:             unitsTable.areaM2,
      monthlyRentDefault: unitsTable.monthlyRentDefault,
      createdAt:          unitsTable.createdAt,
      propertyId:         properties.id,
      propertyName:       properties.name,
    })
    .from(unitsTable)
    .leftJoin(properties, and(eq(properties.id, unitsTable.propertyId), eq(properties.orgId, ctx.orgId)))
    .where(and(eq(unitsTable.id, id), eq(unitsTable.orgId, ctx.orgId)));

  if (!unitRows.length) notFound();
  const unit = unitRows[0];

  // Fetch assigned tenant (tenants.unit_id FK — reverse lookup)
  const tenantRows = await db
    .select({ id: tenants.id, fullName: tenants.fullName })
    .from(tenants)
    .where(and(eq(tenants.unitId, id), eq(tenants.orgId, ctx.orgId)))
    .limit(1);
  const tenant = tenantRows[0] ?? null;

  const createdDate = unit.createdAt
    ? new Date(unit.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
    : '—';

  const toiletLabel =
    unit.toiletType === 'private'
      ? t('toiletType.private')
      : unit.toiletType === 'shared'
        ? t('toiletType.shared')
        : t('toiletType.none');

  // Pre-fetch images for the Images tab (server-side, avoids client waterfall)
  const imagesResult = await getUnitImagesAdmin(id);
  const initialImages = imagesResult.data ?? [];

  const imageLabels = {
    upload: t('images.upload'),
    empty: t('images.empty'),
    setCover: t('images.setCover'),
    delete: t('images.delete'),
    deleteConfirm: t('images.deleteConfirm'),
    cover: t('images.cover'),
    invalidMime: t('images.invalidMime'),
    fileTooLarge: t('images.fileTooLarge'),
    uploadError: t('images.uploadError'),
  };

  const tabs = [
    {
      id: 'details',
      label: 'Details',
      content: (
        <div className="p-4">
          <Card>
            <CardHeader>
              <CardTitle>{unit.label}</CardTitle>
              <StatusPill status={unit.status} />
            </CardHeader>

            <dl className="divide-y divide-slate-100">
              <div className="flex items-center justify-between py-3">
                <dt className="text-sm font-medium text-slate-500 w-36 shrink-0">{t('detail.property')}</dt>
                <dd className="text-sm text-slate-900 flex-1 text-right">
                  {unit.propertyName ?? <span className="text-slate-400">—</span>}
                </dd>
              </div>

              <div className="flex items-center justify-between py-3">
                <dt className="text-sm font-medium text-slate-500 w-36 shrink-0">{t('detail.status')}</dt>
                <dd className="text-sm text-slate-900 flex-1 text-right">
                  <StatusPill status={unit.status} />
                </dd>
              </div>

              {unit.floor && (
                <div className="flex items-center justify-between py-3">
                  <dt className="text-sm font-medium text-slate-500 w-36 shrink-0">{t('detail.floor')}</dt>
                  <dd className="text-sm text-slate-900 flex-1 text-right">{unit.floor}</dd>
                </div>
              )}

              <div className="flex items-center justify-between py-3">
                <dt className="text-sm font-medium text-slate-500 w-36 shrink-0">{t('detail.toiletType')}</dt>
                <dd className="text-sm text-slate-900 flex-1 text-right">{toiletLabel}</dd>
              </div>

              {unit.monthlyRentDefault != null && (
                <div className="flex items-center justify-between py-3">
                  <dt className="text-sm font-medium text-slate-500 w-36 shrink-0">{t('detail.defaultRent')}</dt>
                  <dd className="text-sm text-slate-900 flex-1 text-right">
                    ${Number(unit.monthlyRentDefault).toLocaleString()}
                  </dd>
                </div>
              )}

              <div className="flex items-center justify-between py-3">
                <dt className="text-sm font-medium text-slate-500 w-36 shrink-0">{t('detail.tenant')}</dt>
                <dd className="text-sm flex-1 flex items-center justify-end gap-2">
                  {tenant ? (
                    <Link
                      href={`/dashboard/tenants/${tenant.id}`}
                      className="inline-flex items-center gap-2 text-blue-600 hover:text-blue-800 hover:underline transition-colors"
                    >
                      <Avatar name={tenant.fullName} size="sm" />
                      {tenant.fullName}
                    </Link>
                  ) : (
                    <span className="text-slate-400">{t('detail.unoccupied')}</span>
                  )}
                </dd>
              </div>

              <div className="flex items-center justify-between py-3">
                <dt className="text-sm font-medium text-slate-500 w-36 shrink-0">{t('detail.createdAt')}</dt>
                <dd className="text-sm text-slate-900 flex-1 text-right">{createdDate}</dd>
              </div>
            </dl>
          </Card>
        </div>
      ),
    },
    {
      id: 'images',
      label: t('images.tab'),
      badge: initialImages.length,
      content: (
        <Suspense fallback={<TabFallback />}>
          <ImagesTab unitId={id} initialImages={initialImages} labels={imageLabels} />
        </Suspense>
      ),
    },
  ];

  return (
    <div className="space-y-4 max-w-2xl">
      <Link
        href="/dashboard/units"
        className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 transition-colors"
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <path fillRule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd" />
        </svg>
        {t('detail.backToUnits')}
      </Link>

      <Tabs tabs={tabs} defaultTab="details" className="bg-white border border-slate-200 rounded-xl overflow-hidden" />
    </div>
  );
}
