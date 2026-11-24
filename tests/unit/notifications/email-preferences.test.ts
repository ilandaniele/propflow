import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/db', () => ({ db: {} }));

import { acceptsEmail } from '@/lib/notifications/preferences';
import { DEFAULT_EMAIL_PREFERENCES, EMAIL_CATEGORIES } from '@/lib/notifications/email-categories';
import { EmailPreferencesFormSchema } from '@/lib/schemas/notificationPreferences';

describe('acceptsEmail', () => {
  const optOuts = new Set(['opted-out-profile']);

  it('drops a profile that opted out', () => {
    expect(acceptsEmail(optOuts, 'opted-out-profile')).toBe(false);
  });

  it('keeps a profile with no opt-out', () => {
    expect(acceptsEmail(optOuts, 'other-profile')).toBe(true);
  });

  it('keeps a recipient without a portal profile (cannot opt out)', () => {
    expect(acceptsEmail(optOuts, null)).toBe(true);
  });

  it('filters a recipient list in one pass', () => {
    const recipients = [{ profileId: 'a' }, { profileId: 'opted-out-profile' }, { profileId: null }];
    expect(recipients.filter((r) => acceptsEmail(optOuts, r.profileId))).toEqual([{ profileId: 'a' }, { profileId: null }]);
  });
});

describe('DEFAULT_EMAIL_PREFERENCES', () => {
  it('turns every category on', () => {
    for (const category of EMAIL_CATEGORIES) expect(DEFAULT_EMAIL_PREFERENCES[category]).toBe(true);
  });
});

describe('EmailPreferencesFormSchema', () => {
  it('maps checked boxes to true and missing boxes to false', () => {
    expect(EmailPreferencesFormSchema.parse({ lease_renewal: 'on' })).toEqual({ lease_renewal: true, payment_due: false });
  });

  it('ignores unrelated form fields', () => {
    expect(EmailPreferencesFormSchema.parse({ $ACTION_ID_x: '', payment_due: 'on' })).toEqual({ lease_renewal: false, payment_due: true });
  });

  it('rejects an unexpected checkbox value', () => {
    expect(EmailPreferencesFormSchema.safeParse({ lease_renewal: 'yes' }).success).toBe(false);
  });
});
