/**
 * src/components/finance/RoomProfitabilityTable.tsx
 *
 * Paginated room profitability table (AC23).
 * Server Component — pure presentational.
 *
 * Sort links are rendered as <Link> elements pointing back to the same
 * page with updated `sort` and `page` query params. The Server Component
 * parent validates sort via the ROOM_SORT_COLUMNS allowlist before passing
 * data — this component never constructs raw SQL.
 */

import Link from 'next/link';
import type { RoomProfitabilityRow, RoomSortColumn } from '@/lib/finance/reports';
import { ROOM_SORT_COLUMNS } from '@/lib/finance/reports';

interface RoomProfitabilityTableProps {
  rows: RoomProfitabilityRow[];
  sort: RoomSortColumn;
  page: number;
  totalRows: number;
  pageSize: number;
  basePath: string;
  /** i18n labels */
  labels: {
    room: string;
    property: string;
    revenue: string;
    expenses: string;
    netProfit: string;
    occupancy: string;
    occupied: string;
    vacant: string;
    previous: string;
    next: string;
    noData: string;
    pageInfo: string; // e.g. "Página {page} de {total}"
  };
}

function sortLink(basePath: string, sort: RoomSortColumn, page: number, col: RoomSortColumn): string {
  const params = new URLSearchParams({ sort: col, page: String(page) });
  return `${basePath}?${params.toString()}`;
}

function SortableHeader({
  col,
  currentSort,
  label,
  basePath,
}: {
  col: RoomSortColumn;
  currentSort: RoomSortColumn;
  label: string;
  basePath: string;
}) {
  const isActive = currentSort === col;
  return (
    <th className="text-right py-2 font-medium text-slate-600 pr-3">
      <Link
        href={sortLink(basePath, currentSort, 0, col)}
        className={`hover:text-brand-600 transition-colors ${isActive ? 'text-brand-700 underline' : ''}`}
        aria-label={`Sort by ${label}`}
      >
        {label}
        {isActive && <span aria-hidden="true"> ↓</span>}
      </Link>
    </th>
  );
}

function formatCurrency(n: number): string {
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function RoomProfitabilityTable({
  rows,
  sort,
  page,
  totalRows,
  pageSize,
  basePath,
  labels,
}: RoomProfitabilityTableProps) {
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
  const hasPrev = page > 0;
  const hasNext = page < totalPages - 1;

  const pageParams = (p: number) =>
    `${basePath}?${new URLSearchParams({ sort, page: String(p) }).toString()}`;

  if (rows.length === 0) {
    return (
      <p className="text-sm text-slate-500 py-4">{labels.noData}</p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto">
        <table className="w-full text-sm" data-testid="room-profitability-table">
          <thead>
            <tr className="border-b border-slate-100">
              <th className="text-left py-2 font-medium text-slate-600 pl-1">{labels.room}</th>
              <th className="text-left py-2 font-medium text-slate-600">{labels.property}</th>
              {(ROOM_SORT_COLUMNS as readonly RoomSortColumn[]).map((col) => {
                const labelMap: Record<RoomSortColumn, string> = {
                  revenue: labels.revenue,
                  expenses: labels.expenses,
                  net_profit: labels.netProfit,
                  occupancy: labels.occupancy,
                };
                return (
                  <SortableHeader
                    key={col}
                    col={col}
                    currentSort={sort}
                    label={labelMap[col]}
                    basePath={basePath}
                  />
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.unit_id}
                className="border-b border-slate-50 hover:bg-slate-50"
              >
                <td className="py-2 text-slate-700 pl-1 font-medium">{row.label}</td>
                <td className="py-2 text-slate-500 text-xs">{row.property_name ?? '—'}</td>
                <td className="py-2 text-right text-green-600 pr-3">{formatCurrency(row.revenue)}</td>
                <td className="py-2 text-right text-red-500 pr-3">{formatCurrency(row.expenses)}</td>
                <td className={`py-2 text-right font-semibold pr-3 ${row.net_profit >= 0 ? 'text-slate-900' : 'text-red-600'}`}>
                  {formatCurrency(row.net_profit)}
                </td>
                <td className="py-2 text-right pr-3">
                  <span
                    className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                      row.occupancy === 1
                        ? 'bg-green-100 text-green-700'
                        : 'bg-slate-100 text-slate-500'
                    }`}
                  >
                    {row.occupancy === 1 ? labels.occupied : labels.vacant}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between text-sm text-slate-600">
        <span>
          {labels.pageInfo
            .replace('{page}', String(page + 1))
            .replace('{total}', String(totalPages))}
        </span>
        <div className="flex gap-2">
          {hasPrev ? (
            <Link
              href={pageParams(page - 1)}
              className="px-3 py-1.5 border border-slate-200 rounded hover:bg-slate-50 transition-colors"
            >
              {labels.previous}
            </Link>
          ) : (
            <span className="px-3 py-1.5 border border-slate-100 rounded text-slate-300 cursor-not-allowed">
              {labels.previous}
            </span>
          )}
          {hasNext ? (
            <Link
              href={pageParams(page + 1)}
              className="px-3 py-1.5 border border-slate-200 rounded hover:bg-slate-50 transition-colors"
            >
              {labels.next}
            </Link>
          ) : (
            <span className="px-3 py-1.5 border border-slate-100 rounded text-slate-300 cursor-not-allowed">
              {labels.next}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
