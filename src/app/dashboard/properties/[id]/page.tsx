import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/auth/guards';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { Tabs } from '@/components/ui/Tabs';
import { UtilityContractsSection } from '@/components/utility-contracts/UtilityContractsSection';
import { CustomFieldsCard } from '@/components/custom-fields/CustomFieldsCard';
import { loadPropertyUtilities } from '@/lib/utility-contracts/queries';

export const metadata: Metadata = { title: 'Property Details' };

interface Props {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string; page?: string }>;
}

const PageSchema = z.coerce.number().int().min(1).max(1000).catch(1);

export default async function PropertyDetailPage({ params, searchParams }: Props) {
  const [{ id }, query] = await Promise.all([params, searchParams]);

  let ctx;
  try { ctx = await requireAdmin(); } catch { redirect('/login'); }

  if (!z.string().guid().safeParse(id).success) notFound();
  const page = PageSchema.parse(query.page);

  const [data, t] = await Promise.all([
    loadPropertyUtilities(ctx.orgId, id, page),
    getTranslations('properties'),
  ]);
  if (!data) notFound();
  const { property } = data;

  const tabs = [
    {
      id: 'details',
      label: t('detailTab'),
      content: (
        <div className="p-4 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>{property.name}</CardTitle>
            </CardHeader>
            <p className="text-sm text-slate-500">
              {[property.address, property.city, property.country].filter(Boolean).join(', ') || t('noAddress')}
            </p>
            <Link href={`/dashboard/units?property=${property.id}`} className="mt-3 inline-block text-sm text-blue-600 hover:underline">
              {t('viewUnits')} ({data.units.length})
            </Link>
          </Card>
          <CustomFieldsCard orgId={ctx.orgId} entityType="property" entityId={property.id} />
        </div>
      ),
    },
    {
      id: 'utilities',
      label: t('utilitiesTab'),
      content: <UtilityContractsSection {...data} page={page} />,
    },
  ];

  return (
    <div className="space-y-4 max-w-3xl">
      <Link href="/dashboard/properties" className="text-sm text-slate-500 hover:text-slate-700">
        ← {t('backToProperties')}
      </Link>
      <Tabs
        tabs={tabs}
        defaultTab={query.tab === 'utilities' ? 'utilities' : 'details'}
        className="bg-white border border-slate-200 rounded-xl overflow-hidden"
      />
    </div>
  );
}
