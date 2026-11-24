'use client';

import { useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Input } from '@/components/ui/Input';
import { rentalYield, rentAdjustment, splitExpense } from '@/lib/calculators';

const toNumber = (value: string) => {
  const n = Number(value.replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};

const money = (n: number) => n.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function NumberField({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (v: string) => void }) {
  return <Input id={id} label={label} inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} />;
}

function Section({ title, desc, children }: { title: string; desc: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 p-6 space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
        <p className="text-sm text-slate-500">{desc}</p>
      </div>
      {children}
    </section>
  );
}

function Results({ rows }: { rows: [string, string][] }) {
  return (
    <dl className="grid grid-cols-2 gap-3 rounded-lg bg-slate-50 p-4 text-sm" aria-live="polite">
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt className="text-slate-500">{label}</dt>
          <dd className="text-base font-semibold text-slate-900 tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function YieldCalculator() {
  const t = useTranslations('calculators');
  const [price, setPrice] = useState('120000');
  const [rent, setRent] = useState('1000');
  const [expenses, setExpenses] = useState('100');
  const [vacancy, setVacancy] = useState('1');
  const r = rentalYield({
    price: toNumber(price),
    monthlyRent: toNumber(rent),
    monthlyExpenses: toNumber(expenses),
    vacancyMonths: toNumber(vacancy),
  });
  return (
    <Section title={t('yield.title')} desc={t('yield.desc')}>
      <div className="grid gap-3 sm:grid-cols-2">
        <NumberField id="yield-price" label={t('yield.price')} value={price} onChange={setPrice} />
        <NumberField id="yield-rent" label={t('yield.rent')} value={rent} onChange={setRent} />
        <NumberField id="yield-expenses" label={t('yield.expenses')} value={expenses} onChange={setExpenses} />
        <NumberField id="yield-vacancy" label={t('yield.vacancy')} value={vacancy} onChange={setVacancy} />
      </div>
      <Results
        rows={[
          [t('yield.gross'), `${r.grossYield}%`],
          [t('yield.net'), `${r.netYield}%`],
          [t('yield.annualNet'), money(r.annualNet)],
          [t('yield.payback'), r.paybackYears === null ? '—' : t('yield.years', { years: r.paybackYears })],
        ]}
      />
    </Section>
  );
}

function AdjustmentCalculator() {
  const t = useTranslations('calculators');
  const [rent, setRent] = useState('1500');
  const [percent, setPercent] = useState('3.5');
  const r = rentAdjustment(toNumber(rent), toNumber(percent));
  return (
    <Section title={t('adjustment.title')} desc={t('adjustment.desc')}>
      <div className="grid gap-3 sm:grid-cols-2">
        <NumberField id="adj-rent" label={t('adjustment.rent')} value={rent} onChange={setRent} />
        <NumberField id="adj-percent" label={t('adjustment.percent')} value={percent} onChange={setPercent} />
      </div>
      <Results
        rows={[
          [t('adjustment.newRent'), money(r.newRent)],
          [t('adjustment.difference'), money(r.difference)],
        ]}
      />
    </Section>
  );
}

function SplitCalculator() {
  const t = useTranslations('calculators');
  const [total, setTotal] = useState('600');
  const [byArea, setByArea] = useState(false);
  const [units, setUnits] = useState([
    { label: '101', area: '60' },
    { label: '102', area: '80' },
    { label: '201', area: '100' },
  ]);
  const shares = splitExpense(
    toNumber(total),
    units.map((u) => ({ label: u.label, area: toNumber(u.area) })),
    byArea,
  );
  const updateUnit = (index: number, field: 'label' | 'area', value: string) =>
    setUnits((prev) => prev.map((u, i) => (i === index ? { ...u, [field]: value } : u)));
  return (
    <Section title={t('split.title')} desc={t('split.desc')}>
      <div className="grid gap-3 sm:grid-cols-2">
        <NumberField id="split-total" label={t('split.total')} value={total} onChange={setTotal} />
        <label className="flex items-center gap-2 self-end text-sm text-slate-700">
          <input type="checkbox" checked={byArea} onChange={(e) => setByArea(e.target.checked)} />
          {t('split.byArea')}
        </label>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-slate-500">
            <th className="py-1 font-medium">{t('split.unit')}</th>
            <th className="py-1 font-medium">{t('split.area')}</th>
            <th className="py-1 font-medium text-right">{t('split.share')}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {units.map((unit, index) => (
            <tr key={index}>
              <td className="py-1 pr-2">
                <input aria-label={t('split.unit')} className="w-full rounded border border-slate-200 px-2 py-1" value={unit.label} onChange={(e) => updateUnit(index, 'label', e.target.value)} />
              </td>
              <td className="py-1 pr-2">
                <input aria-label={t('split.area')} inputMode="decimal" className="w-full rounded border border-slate-200 px-2 py-1" value={unit.area} onChange={(e) => updateUnit(index, 'area', e.target.value)} />
              </td>
              <td className="py-1 text-right font-semibold tabular-nums">{money(shares[index]?.amount ?? 0)}</td>
              <td className="py-1 pl-2 text-right">
                <button type="button" className="text-slate-400 hover:text-red-600" aria-label={t('split.remove')} onClick={() => setUnits((prev) => prev.filter((_, i) => i !== index))}>×</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button type="button" className="text-sm font-medium text-brand-700 hover:underline" onClick={() => setUnits((prev) => [...prev, { label: '', area: '0' }])}>
        {t('split.add')}
      </button>
    </Section>
  );
}

export function Calculators() {
  return (
    <div className="space-y-8">
      <YieldCalculator />
      <AdjustmentCalculator />
      <SplitCalculator />
    </div>
  );
}
