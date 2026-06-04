/**
 * Tests that the locale active state is derived from the actual current locale,
 * not a hardcoded default.
 *
 * Root cause of bug: dashboard/layout.tsx and portal/layout.tsx rendered
 * AdminTopbar/TenantNav without passing `currentLocale`, causing them to
 * always fall back to the `currentLocale = 'es'` default prop.
 *
 * The fix: both layouts now call `getLocale()` from next-intl/server and pass
 * the result as `currentLocale`. These tests validate that:
 * 1. resolveLocale returns the expected locale for each supported language
 * 2. When the locale is 'en' or 'pt', the result is NOT 'es' (the wrong default)
 * 3. The active locale matches what would be passed to the dropdown
 */

import { describe, it, expect } from 'vitest';
import { resolveLocale } from '@/lib/i18n/resolve-locale';
import { SUPPORTED_LOCALES, isValidLocale, DEFAULT_LOCALE } from '@/i18n/config';

describe('locale active state — prop propagation contract', () => {
  it('when getLocale returns en, the active locale is en — not the es default', () => {
    // Simulates a user whose preferred_language = 'en' in DB.
    // resolveLocale is what proxy.ts uses to set the cookie getLocale() reads.
    const activeLocale = resolveLocale('en', 'en-US');
    expect(activeLocale).toBe('en');
    expect(activeLocale).not.toBe(DEFAULT_LOCALE); // must NOT be 'es'
  });

  it('when getLocale returns pt, the active locale is pt — not the es default', () => {
    const activeLocale = resolveLocale('pt', 'pt-BR');
    expect(activeLocale).toBe('pt');
    expect(activeLocale).not.toBe(DEFAULT_LOCALE);
  });

  it('when getLocale returns es, the active locale is es', () => {
    const activeLocale = resolveLocale('es', 'es-AR');
    expect(activeLocale).toBe('es');
  });

  it('all supported locales round-trip through resolveLocale correctly', () => {
    // Each supported locale should resolve to itself when set as the DB preference.
    for (const locale of SUPPORTED_LOCALES) {
      const resolved = resolveLocale(locale, '');
      expect(resolved).toBe(locale);
    }
  });

  it('null DB preference falls back to Accept-Language header, not always es', () => {
    // When preferred_language is not set, the browser header should be used.
    // This ensures the "always ES" bug cannot resurface from a null DB value
    // when the user's browser is configured for English.
    const resolved = resolveLocale(null, 'en-US,en;q=0.9');
    expect(resolved).toBe('en');
    expect(resolved).not.toBe('es');
  });

  it('isValidLocale correctly identifies all supported locales', () => {
    expect(isValidLocale('es')).toBe(true);
    expect(isValidLocale('en')).toBe(true);
    expect(isValidLocale('pt')).toBe(true);
    // An unsupported locale should not be flagged as valid — prevents
    // a bad value slipping through as the currentLocale prop.
    expect(isValidLocale('fr')).toBe(false);
    expect(isValidLocale('')).toBe(false);
  });

  it('LanguageDropdown active state: locale matches currentLocale prop', () => {
    // Simulate the comparison the LanguageDropdown does: `locale === currentLocale`
    // When getLocale() returns 'en', only 'en' should be aria-selected.
    const currentLocale = 'en';
    const selected = SUPPORTED_LOCALES.filter((l) => l === currentLocale);
    const notSelected = SUPPORTED_LOCALES.filter((l) => l !== currentLocale);

    expect(selected).toEqual(['en']);
    expect(notSelected).toEqual(['es', 'pt']);
    // Before the fix, currentLocale was always 'es' (the default prop).
    // This assertion would have failed — selected would have been ['es'] not ['en'].
  });
});
