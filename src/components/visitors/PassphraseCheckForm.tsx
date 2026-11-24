import { getTranslations } from 'next-intl/server';

export async function PassphraseCheckForm({ code, clearHref }: { code?: string; clearHref: string }) {
  const t = await getTranslations('visitorAccess');
  return (
    <form method="get" className="flex flex-wrap items-end gap-3">
      <div className="space-y-1">
        <label htmlFor="code" className="block text-sm font-medium text-slate-700">{t('checkPassphrase')}</label>
        <input id="code" name="code" defaultValue={code ?? ''} className="h-9 rounded border border-slate-300 px-2 text-sm" />
      </div>
      <button type="submit" className="h-9 rounded bg-slate-800 px-3 text-sm text-white">{t('check')}</button>
      {code && <a href={clearHref} className="text-sm text-brand-600 hover:underline">{t('clear')}</a>}
    </form>
  );
}
