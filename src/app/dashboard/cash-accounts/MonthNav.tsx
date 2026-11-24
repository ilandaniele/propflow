import Link from 'next/link';
import { shiftMonth } from '@/lib/finance/cash-ledger-math';

const linkClasses = 'rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50';

export function MonthNav({ basePath, month, previousLabel, nextLabel }: {
  basePath: string;
  month: string;
  previousLabel: string;
  nextLabel: string;
}) {
  return (
    <nav className="flex items-center gap-2" aria-label={month}>
      <Link href={`${basePath}?month=${shiftMonth(month, -1)}`} className={linkClasses}>{previousLabel}</Link>
      <span className="text-sm font-semibold text-slate-900 tabular-nums">{month}</span>
      <Link href={`${basePath}?month=${shiftMonth(month, 1)}`} className={linkClasses}>{nextLabel}</Link>
    </nav>
  );
}
