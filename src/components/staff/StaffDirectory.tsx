import type { ReactNode } from 'react';
import { getTranslations } from 'next-intl/server';

export interface StaffDirectoryRow {
  id: string;
  fullName: string;
  position: string;
  shift: string | null;
  propertyName: string | null;
  phone?: string | null;
  documentNumber?: string | null;
}

type Props = {
  rows: StaffDirectoryRow[];
  renderAction?: (id: string) => ReactNode;
};

export async function StaffDirectory({ rows, renderAction }: Props) {
  const t = await getTranslations('staff');
  if (rows.length === 0) return <p className="text-sm text-slate-500">{t('empty')}</p>;

  return (
    <ul className="divide-y divide-slate-100">
      {rows.map((row) => (
        <li key={row.id} className="flex items-center justify-between gap-3 py-2 text-sm">
          <div>
            <p className="font-medium text-slate-900">{row.fullName} <span className="font-normal text-slate-500">· {row.position}</span></p>
            <p className="text-slate-500">
              {[row.propertyName ?? t('allProperties'), row.shift, row.phone, row.documentNumber].filter(Boolean).join(' · ')}
            </p>
          </div>
          {renderAction?.(row.id)}
        </li>
      ))}
    </ul>
  );
}
