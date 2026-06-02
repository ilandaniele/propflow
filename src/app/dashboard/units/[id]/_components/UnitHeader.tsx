/**
 * Unit header — label, property, floor, default rent, toilet type badge, status.
 * Server Component (no 'use client').
 */

import { Badge, StatusPill } from '@/components/ui/Badge';

interface UnitHeaderProps {
  unit: {
    label: string;
    floor?: string | null;
    monthly_rent_default?: number | null;
    toilet_type?: string | null;
    status: string;
    properties: { name: string } | null;
  };
}

function ToiletTypeBadge({ value }: { value: string | null | undefined }) {
  if (value === 'private') {
    return <Badge variant="info">Private bathroom</Badge>;
  }
  if (value === 'shared') {
    return <Badge variant="default">Shared bathroom</Badge>;
  }
  return null;
}

export function UnitHeader({ unit }: UnitHeaderProps) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-6">
      <div className="flex items-start gap-4 flex-wrap">
        {/* Icon placeholder */}
        <div className="shrink-0 h-11 w-11 rounded-full bg-slate-100 flex items-center justify-center text-slate-500">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
            <polyline points="9 22 9 12 15 12 15 22" />
          </svg>
        </div>

        {/* Name + property + badges */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-bold text-slate-900 truncate">{unit.label}</h1>
            <StatusPill status={unit.status} />
            {unit.toilet_type && <ToiletTypeBadge value={unit.toilet_type} />}
          </div>

          <p className="text-sm text-slate-500 mt-1">
            {unit.properties?.name ?? 'No property'}
            {unit.floor ? ` — Floor ${unit.floor}` : ''}
          </p>
        </div>

        {/* Default rent */}
        {unit.monthly_rent_default && (
          <div className="shrink-0 text-right">
            <div className="text-2xl font-bold text-slate-900">
              ${Number(unit.monthly_rent_default).toLocaleString()}
            </div>
            <div className="text-xs text-slate-500 mt-0.5">Default rent / mo</div>
          </div>
        )}
      </div>
    </div>
  );
}
