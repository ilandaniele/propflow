import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { requireAdmin } from '@/lib/auth/guards';
import { Card } from '@/components/ui/Card';
import { globalSearch, groupHits, hitHref, normalizeQuery, SEARCH_MIN_LENGTH } from '@/lib/search/global';

export const metadata: Metadata = { title: 'Search' };

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  let ctx;
  try { ctx = await requireAdmin(); } catch { redirect('/login'); }

  const { q: raw } = await searchParams;
  const query = normalizeQuery(typeof raw === 'string' ? raw : undefined);
  const [t, hits] = await Promise.all([
    getTranslations('globalSearch'),
    query ? globalSearch(ctx.orgId, query) : Promise.resolve([]),
  ]);
  const groups = groupHits(hits);

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">{t('title')}</h1>
        <form action="/dashboard/search" method="get" role="search" className="mt-3 flex gap-2">
          <label htmlFor="search-page-q" className="sr-only">{t('title')}</label>
          <input
            id="search-page-q"
            name="q"
            type="search"
            defaultValue={typeof raw === 'string' ? raw : ''}
            placeholder={t('placeholder')}
            className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          />
          <button type="submit" className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">
            {t('submit')}
          </button>
        </form>
      </div>

      {!query ? (
        <p className="text-sm text-slate-500">{t('hint', { min: SEARCH_MIN_LENGTH })}</p>
      ) : groups.length === 0 ? (
        <p className="text-sm text-slate-500">{t('noResults', { query })}</p>
      ) : (
        groups.map((group) => (
          <Card key={group.kind} padding="none">
            <h2 className="px-4 pt-4 pb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              {t(`kinds.${group.kind}`)}
            </h2>
            <ul className="divide-y divide-slate-100">
              {group.hits.map((hit) => (
                <li key={hit.id}>
                  <Link href={hitHref(hit)} className="block px-4 py-3 hover:bg-slate-50">
                    <p className="text-sm font-medium text-slate-900">{hit.title}</p>
                    {hit.subtitle && <p className="text-xs text-slate-500">{hit.subtitle}</p>}
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        ))
      )}
    </div>
  );
}
