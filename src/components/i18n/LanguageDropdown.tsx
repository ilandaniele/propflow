'use client';

import { useTransition, useState } from 'react';
import { SUPPORTED_LOCALES, LOCALE_NAMES, type Locale } from '@/i18n/config';
import { updateMyPreferredLanguage } from '@/app/actions/profile';

interface LanguageDropdownProps {
  currentLocale: Locale;
}

/**
 * Language selector dropdown.
 * Calls updateMyPreferredLanguage Server Action on change.
 * Reloads page after successful update so next-intl picks up the new locale cookie.
 */
export function LanguageDropdown({ currentLocale }: LanguageDropdownProps) {
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);

  function handleSelect(locale: Locale) {
    if (locale === currentLocale) {
      setOpen(false);
      return;
    }
    setOpen(false);
    const formData = new FormData();
    formData.set('language', locale);
    startTransition(async () => {
      await updateMyPreferredLanguage({}, formData);
      // Reload to apply new locale cookie
      window.location.reload();
    });
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        disabled={isPending}
        className="flex items-center gap-1.5 px-2 py-1 text-sm text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-md transition-colors disabled:opacity-50"
        aria-label="Select language"
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="10"/><line x1="2" x2="22" y1="12" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
        </svg>
        <span className="font-medium">{currentLocale.toUpperCase()}</span>
        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>

      {open && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-10"
            aria-hidden="true"
            onClick={() => setOpen(false)}
          />
          {/* Dropdown */}
          <ul
            role="listbox"
            aria-label="Select language"
            className="absolute right-0 mt-1 w-40 bg-white border border-slate-200 rounded-lg shadow-lg z-20 py-1 text-sm"
          >
            {SUPPORTED_LOCALES.map((locale) => (
              <li key={locale}>
                <button
                  role="option"
                  aria-selected={locale === currentLocale}
                  onClick={() => handleSelect(locale)}
                  className={[
                    'w-full text-left px-3 py-2 hover:bg-slate-50 transition-colors flex items-center gap-2',
                    locale === currentLocale ? 'text-brand-700 font-medium' : 'text-slate-700',
                  ].join(' ')}
                >
                  {locale === currentLocale && (
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <polyline points="20 6 9 17 4 12"/>
                    </svg>
                  )}
                  {locale !== currentLocale && <span className="w-3.5" />}
                  {LOCALE_NAMES[locale]}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
