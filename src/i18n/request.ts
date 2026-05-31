/**
 * next-intl request configuration.
 * Called by next-intl on every server render to determine locale + messages.
 * Non-segment approach: locale comes from cookie (set by language selector).
 */

import { getRequestConfig } from 'next-intl/server';
import { cookies } from 'next/headers';
import { DEFAULT_LOCALE, isValidLocale, LOCALE_COOKIE } from './config';

export default getRequestConfig(async () => {
  const store = await cookies();
  const cookieLocale = store.get(LOCALE_COOKIE)?.value;
  const locale = cookieLocale && isValidLocale(cookieLocale) ? cookieLocale : DEFAULT_LOCALE;

  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
  };
});
