import { getTranslations } from 'next-intl/server';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { rollupBeds } from '@/lib/unit-beds/rollup';
import type { UnitBedRow } from '@/lib/unit-beds/queries';
import { UnitBedForm } from './UnitBedForm';
import { AssignUnitBedForm } from './AssignUnitBedForm';
import { RemoveUnitBedButton } from './RemoveUnitBedButton';

type Props = {
  unitId: string;
  beds: UnitBedRow[];
  tenants: { id: string; name: string }[];
};

const money = (value: number) => `$${value.toLocaleString()}`;

export async function UnitBedsSection({ unitId, beds, tenants }: Props) {
  const t = await getTranslations('unitBeds');
  const rollup = rollupBeds(beds);
  const stats = [
    { label: t('stats.beds'), value: String(rollup.totalBeds) },
    { label: t('stats.occupied'), value: `${rollup.occupiedBeds} (${rollup.occupancyPct}%)` },
    { label: t('stats.potentialRent'), value: money(rollup.potentialRent) },
    { label: t('stats.occupiedRent'), value: money(rollup.occupiedRent) },
  ];

  return (
    <div className="p-4">
      <Card>
        <CardHeader>
          <CardTitle>{t('title')}</CardTitle>
        </CardHeader>
        <p className="mb-4 text-sm text-slate-500">{t('subtitle')}</p>

        <dl className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {stats.map((stat) => (
            <div key={stat.label} className="rounded-lg bg-slate-50 p-3">
              <dt className="text-xs text-slate-500">{stat.label}</dt>
              <dd className="text-lg font-semibold text-slate-900">{stat.value}</dd>
            </div>
          ))}
        </dl>

        {beds.length === 0 ? (
          <p className="mb-4 text-sm text-slate-400">{t('empty')}</p>
        ) : (
          <ul className="mb-4 divide-y divide-slate-100">
            {beds.map((bed) => (
              <li key={bed.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <div>
                  <p className="text-sm font-medium text-slate-900">{bed.label}</p>
                  <p className="text-xs text-slate-500">
                    {bed.monthlyRent != null ? money(Number(bed.monthlyRent)) : t('noRent')}
                  </p>
                </div>
                <div className="flex items-center gap-4">
                  <AssignUnitBedForm bedId={bed.id} tenantId={bed.tenantId} tenants={tenants} />
                  <RemoveUnitBedButton id={bed.id} />
                </div>
              </li>
            ))}
          </ul>
        )}

        <UnitBedForm unitId={unitId} />
      </Card>
    </div>
  );
}
