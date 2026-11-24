import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { shiftDate } from '@/lib/amenities/slot-math';

const navClasses = 'rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50';

export async function DayNav({ date, basePath, query = {} }: { date: string; basePath: string; query?: Record<string, string> }) {
  const t = await getTranslations('amenities');
  const href = (day: string) => `${basePath}?${new URLSearchParams({ ...query, date: day })}`;

  return (
    <nav className="flex items-center gap-2" aria-label={t('dayNav')}>
      <Link href={href(shiftDate(date, -1))} className={navClasses}>{t('previousDay')}</Link>
      <span className="text-sm font-semibold text-slate-700 tabular-nums">{date}</span>
      <Link href={href(shiftDate(date, 1))} className={navClasses}>{t('nextDay')}</Link>
    </nav>
  );
}
