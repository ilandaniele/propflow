/**
 * Tenant email categories a resident may turn off (V19). Transactional mail
 * (portal invitation, contract signature request) is never listed here and
 * never checks preferences.
 */
export const EMAIL_CATEGORIES = ['lease_renewal', 'payment_due'] as const;
export type EmailCategory = (typeof EMAIL_CATEGORIES)[number];
export type EmailPreferences = Record<EmailCategory, boolean>;

export const DEFAULT_EMAIL_PREFERENCES: EmailPreferences = { lease_renewal: true, payment_due: true };
