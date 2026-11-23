'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { OrgLogo } from '@/components/shell/OrgLogo';
import type { OrgBranding } from '@/lib/branding/org-branding';

const DEFAULT_ACCENT = '#0f172a';
const ERROR_KEYS: Record<string, 'errorTooLarge' | 'errorInvalidFile' | 'errorInvalidColor'> = {
  IMAGE_TOO_LARGE: 'errorTooLarge',
  IMAGE_INVALID_MIME: 'errorInvalidFile',
  VALIDATION_ERROR: 'errorInvalidColor',
};

export function BrandingForm({ initial }: { initial: OrgBranding }) {
  const t = useTranslations('branding');
  const router = useRouter();
  const [accent, setAccent] = useState(initial.accentColor ?? DEFAULT_ACCENT);
  const [useAccent, setUseAccent] = useState(initial.accentColor !== null);
  const [logo, setLogo] = useState<File | null>(null);
  const [removeLogo, setRemoveLogo] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);
    const body = new FormData();
    body.set('accent_color', useAccent ? accent : '');
    body.set('remove_logo', String(removeLogo));
    if (logo) body.set('logo', logo);
    try {
      const response = await fetch('/api/org-branding', { method: 'PUT', body });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: { code?: string } } | null;
        const key = ERROR_KEYS[payload?.error?.code ?? ''];
        setError(t(key ?? 'errorGeneric'));
        return;
      }
      setLogo(null);
      setRemoveLogo(false);
      setSaved(true);
      router.refresh();
    } catch {
      setError(t('errorGeneric'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-2xl space-y-4">
      <div>
        <h1 className="text-xl font-bold text-slate-900">{t('title')}</h1>
        <p className="text-sm text-slate-500 mt-1">{t('subtitle')}</p>
      </div>

      <Card padding="md">
        <form onSubmit={submit} className="space-y-6">
          {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
          {saved && <p className="text-sm text-emerald-600" role="status">{t('saved')}</p>}

          <section className="space-y-2">
            <h2 className="text-sm font-semibold text-slate-900">{t('logoTitle')}</h2>
            <p className="text-xs text-slate-500">{t('logoHint')}</p>
            {initial.logoUrl && !removeLogo && (
              <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                <OrgLogo src={initial.logoUrl} alt={t('currentLogo')} className="h-12 max-w-[160px]" />
                <button
                  type="button"
                  onClick={() => setRemoveLogo(true)}
                  className="ml-auto text-xs font-medium text-red-600 hover:text-red-700 underline"
                >
                  {t('removeLogo')}
                </button>
              </div>
            )}
            {removeLogo && <p className="text-xs text-amber-600">{t('logoWillBeRemoved')}</p>}
            <input
              type="file"
              name="logo"
              accept="image/png,image/jpeg,image/webp"
              onChange={(e) => setLogo(e.target.files?.[0] ?? null)}
              aria-label={t('logoTitle')}
              className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-slate-700 hover:file:bg-slate-200"
            />
          </section>

          <section className="space-y-2">
            <h2 className="text-sm font-semibold text-slate-900">{t('accentTitle')}</h2>
            <p className="text-xs text-slate-500">{t('accentHint')}</p>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={useAccent}
                onChange={(e) => setUseAccent(e.target.checked)}
                className="rounded border-slate-300"
              />
              {t('useAccent')}
            </label>
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={accent}
                disabled={!useAccent}
                onChange={(e) => setAccent(e.target.value)}
                aria-label={t('accentTitle')}
                className="h-9 w-14 cursor-pointer rounded border border-slate-300 bg-white disabled:cursor-not-allowed disabled:opacity-50"
              />
              <code className="text-sm text-slate-600">{useAccent ? accent : '—'}</code>
            </div>
          </section>

          <div className="flex justify-end">
            <Button type="submit" loading={saving}>{t('save')}</Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
