import { getTranslations } from 'next-intl/server';
import { Card } from '@/components/ui/Card';
import type { PropertyComparison } from '@/lib/properties/comparison';

type Metrics = Omit<PropertyComparison, 'id' | 'name'>;
type Column = { id: string; name: string; metrics: Metrics };

const money = (n: number) => `S/ ${n.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const METRICS: { key: string; render: (m: Metrics) => string }[] = [
  { key: 'units', render: (m) => `${m.occupiedUnits}/${m.totalUnits}` },
  { key: 'occupancy', render: (m) => `${m.occupancyPct}%` },
  { key: 'contractedRent', render: (m) => money(m.contractedRent) },
  { key: 'collected', render: (m) => money(m.collected) },
  { key: 'expenses', render: (m) => money(m.expenses) },
  { key: 'net', render: (m) => money(m.net) },
  { key: 'openIncidents', render: (m) => String(m.openIncidents) },
];

export async function PropertyComparisonTable({ rows, totals }: { rows: PropertyComparison[]; totals?: { label: string; metrics: Metrics } }) {
  const t = await getTranslations('propertyComparison');
  const columns: Column[] = rows.map((r) => ({ id: r.id, name: r.name, metrics: r }));
  if (totals) columns.push({ id: 'totals', name: totals.label, metrics: totals.metrics });

  return (
    <Card padding="none" className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-100 text-left">
            <th scope="col" className="px-4 py-3 font-medium text-slate-500">{t('metric')}</th>
            {columns.map((c) => <th key={c.id} scope="col" className="px-4 py-3 font-semibold text-slate-900">{c.name}</th>)}
          </tr>
        </thead>
        <tbody>
          {METRICS.map((m) => (
            <tr key={m.key} className="border-b border-slate-50 last:border-0">
              <th scope="row" className="px-4 py-3 text-left font-normal text-slate-600">{t(`metrics.${m.key}`)}</th>
              {columns.map((c) => (
                <td key={c.id} className={`px-4 py-3 tabular-nums text-slate-900 ${c.id === 'totals' ? 'font-semibold bg-slate-50' : ''}`}>
                  {m.render(c.metrics)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
