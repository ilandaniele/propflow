/**
 * i18n configuration for next-intl.
 * Non-segment approach: locale resolved from cookie/profile at request time.
 * Default locale: 'es' (Spanish).
 */

export const SUPPORTED_LOCALES = ['es', 'en', 'pt'] as const;
export type Locale = typeof SUPPORTED_LOCALES[number];

export const DEFAULT_LOCALE: Locale = 'es';

export function isValidLocale(locale: string): locale is Locale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(locale);
}

export const LOCALE_NAMES: Record<Locale, string> = {
  es: 'Español',
  en: 'English',
  pt: 'Português',
};

/** Cookie name used to persist locale preference between requests. */
export const LOCALE_COOKIE = 'propflow_locale';
