/**
 * Server-side locale resolver.
 * Order of precedence: 1) DB profile.preferred_language, 2) Accept-Language header, 3) 'es'
 *
 * Updates profiles.preferred_language if it was NULL (first-visit auto-detect).
 */

import { DEFAULT_LOCALE, isValidLocale, type Locale } from '@/i18n/config';

/**
 * Parse Accept-Language header and return the best supported locale.
 * Example: "es-AR,es;q=0.9,en;q=0.8" → "es"
 */
export function parseAcceptLanguage(header: string | null): Locale {
  if (!header) return DEFAULT_LOCALE;

  const parts = header
    .split(',')
    .map((part) => {
      const [lang, q] = part.trim().split(';q=');
      return { lang: lang.trim().toLowerCase(), q: parseFloat(q ?? '1') };
    })
    .sort((a, b) => b.q - a.q);

  for (const { lang } of parts) {
    // Try exact match (e.g., "es")
    if (isValidLocale(lang)) return lang;
    // Try language prefix match (e.g., "es-AR" → "es")
    const prefix = lang.split('-')[0];
    if (prefix && isValidLocale(prefix)) return prefix;
  }

  return DEFAULT_LOCALE;
}

/**
 * Resolve locale from profile DB value or Accept-Language header.
 * Returns the resolved locale.
 */
export function resolveLocale(
  profileLanguage: string | null | undefined,
  acceptLanguageHeader: string | null
): Locale {
  // 1. DB value takes precedence
  if (profileLanguage && isValidLocale(profileLanguage)) {
    return profileLanguage;
  }

  // 2. Accept-Language header auto-detect
  const detected = parseAcceptLanguage(acceptLanguageHeader);
  return detected;
}
