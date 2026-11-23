import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { requireAdmin } from '@/lib/auth/guards';
import { leadConversionContext } from '@/lib/leads/conversion';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { ConvertLeadForm } from './ConvertLeadForm';

export const metadata: Metadata = { title: 'Convert lead' };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function addYear(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCFullYear(date.getUTCFullYear() + 1);
  return date.toISOString().slice(0, 10);
}

export default async function ConvertLeadPage({ params }: { params: Promise<{ id: string }> }) {
  let ctx;
  try { ctx = await requireAdmin(); } catch { redirect('/login'); }

  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();

  const [context, t] = await Promise.all([leadConversionContext(ctx.orgId, id), getTranslations('leadConversion')]);
  if (!context) notFound();

  const startDate = context.lead.moveInDate ?? new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <Link href="/dashboard/leads" className="text-sm text-slate-500 underline">{t('back')}</Link>
        <h1 className="text-2xl font-bold text-slate-900 mt-2">{t('title')}</h1>
        <p className="text-sm text-slate-500 mt-1">{t('subtitle')}</p>
      </div>

      <Card>
        {context.conversion ? (
          <div className="space-y-2">
            <p className="text-sm text-slate-700">{t('alreadyConverted')}</p>
            <Link href={`/dashboard/tenants/${context.conversion.tenantId}`} className="text-sm text-brand-600 underline">
              {t('openTenant')}
            </Link>
          </div>
        ) : context.units.length === 0 ? (
          <EmptyState title={t('noUnitsTitle')} description={t('noUnitsDesc')} />
        ) : (
          <ConvertLeadForm
            lead={{ id: context.lead.id, fullName: context.lead.fullName, email: context.lead.email ?? '', phone: context.lead.phone ?? '' }}
            units={context.units.map((unit) => ({
              id: unit.id,
              label: `${unit.propertyName} · ${unit.label}`,
              occupied: unit.status === 'occupied',
              monthlyRentDefault: unit.monthlyRentDefault ?? '',
            }))}
            startDate={startDate}
            endDate={addYear(startDate)}
          />
        )}
      </Card>
    </div>
  );
}
