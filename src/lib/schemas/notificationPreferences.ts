import { z } from 'zod';

const checkbox = z.literal('on').optional().transform((v) => v === 'on');

/** HTML checkboxes submit 'on' when checked and nothing when unchecked. */
export const EmailPreferencesFormSchema = z.object({
  lease_renewal: checkbox,
  payment_due:   checkbox,
  announcements: checkbox,
});
