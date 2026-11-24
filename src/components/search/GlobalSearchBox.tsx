'use client';

import { useTranslations } from 'next-intl';
import { SEARCH_MAX_LENGTH, SEARCH_MIN_LENGTH } from '@/lib/search/limits';

export function GlobalSearchBox({ defaultValue = '' }: { defaultValue?: string }) {
  const t = useTranslations('globalSearchBox');
  return (
    <form action="/dashboard/search" method="get" role="search" className="hidden sm:block">
      <label htmlFor="global-search" className="sr-only">{t('label')}</label>
      <input
        id="global-search"
        name="q"
        type="search"
        defaultValue={defaultValue}
        minLength={SEARCH_MIN_LENGTH}
        maxLength={SEARCH_MAX_LENGTH}
        placeholder={t('placeholder')}
        className="w-64 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
      />
    </form>
  );
}
