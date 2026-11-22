/**
 * Single source of truth for whether auth cookies carry the Secure flag and the
 * `__Secure-` prefix. Shared by NextAuth (`useSecureCookies`) and the manual
 * password-session cookie so both always agree on the cookie name.
 */
export function shouldUseSecureAuthCookies(): boolean {
  if (process.env.NODE_ENV === 'production') return true;
  const url = process.env.AUTH_URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? '';
  return url.startsWith('https://');
}
