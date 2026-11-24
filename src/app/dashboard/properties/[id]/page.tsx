import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { and, eq } from 'drizzle-orm';
import { getTranslations } from 'next-intl/server';
import { requireAdmin } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { properties } from '@/lib/db/schema';
import { CustomFieldsCard } from '@/components/custom-fields/CustomFieldsCard';

export const metadata: Metadata = { title: 'Property Details' };

export default async function PropertyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let ctx;
  try { ctx = await requireAdmin(); } catch { redirect('/login'); }

  const [[property], t] = await Promise.all([
    db
      .select({ id: properties.id, name: properties.name, address: properties.address, city: properties.city, country: properties.country })
      .from(properties)
      .where(and(eq(properties.id, id), eq(properties.orgId, ctx.orgId)))
      .limit(1),
    getTranslations('customFields'),
  ]);

  if (!property) notFound();

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <Link href="/dashboard/properties" className="text-sm text-slate-500 hover:text-slate-700">← {t('back')}</Link>
        <h1 className="mt-2 text-2xl font-bold text-slate-900">{property.name}</h1>
        <p className="text-sm text-slate-500 mt-1">
          {[property.address, property.city, property.country].filter(Boolean).join(', ')}
        </p>
      </div>
      <CustomFieldsCard orgId={ctx.orgId} entityType="property" entityId={property.id} />
    </div>
  );
}
