import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { notificationPreferences, profiles } from '@/lib/db/schema';
import { DEFAULT_EMAIL_PREFERENCES, type EmailCategory, type EmailPreferences } from './email-categories';

const COLUMN_BY_CATEGORY = {
  lease_renewal: notificationPreferences.leaseRenewalEmail,
  payment_due:   notificationPreferences.paymentDueEmail,
} as const;

/** Profile ids in the org that opted out of `category`. One query per org and category, no IN list. */
export async function loadEmailOptOuts(orgId: string, category: EmailCategory): Promise<Set<string>> {
  const rows = await db
    .select({ profileId: notificationPreferences.profileId })
    .from(notificationPreferences)
    .where(and(eq(notificationPreferences.orgId, orgId), eq(COLUMN_BY_CATEGORY[category], false)));
  return new Set(rows.map((r) => r.profileId));
}

/** Recipients without a portal profile cannot opt out, so they always get the email. */
export function acceptsEmail(optOuts: ReadonlySet<string>, profileId: string | null): boolean {
  return profileId === null || !optOuts.has(profileId);
}

export async function getEmailPreferences(orgId: string, profileId: string): Promise<EmailPreferences> {
  const [row] = await db
    .select({ lease_renewal: notificationPreferences.leaseRenewalEmail, payment_due: notificationPreferences.paymentDueEmail })
    .from(notificationPreferences)
    .where(and(eq(notificationPreferences.profileId, profileId), eq(notificationPreferences.orgId, orgId)))
    .limit(1);
  return row ?? DEFAULT_EMAIL_PREFERENCES;
}

/**
 * Upserts the profile's preferences. The row is only written when the profile
 * belongs to `orgId`, and an existing row is only updated within its own org.
 */
export async function saveEmailPreferences(orgId: string, profileId: string, prefs: EmailPreferences): Promise<void> {
  const now = new Date();
  await db
    .insert(notificationPreferences)
    .select(
      db
        .select({
          profileId:         profiles.id,
          orgId:             profiles.orgId,
          leaseRenewalEmail: sql<boolean>`${prefs.lease_renewal ? 1 : 0}`.as('lease_renewal_email'),
          paymentDueEmail:   sql<boolean>`${prefs.payment_due ? 1 : 0}`.as('payment_due_email'),
          updatedAt:         sql<Date>`${now.getTime()}`.as('updated_at'),
        })
        .from(profiles)
        .where(and(eq(profiles.id, profileId), eq(profiles.orgId, orgId))),
    )
    .onConflictDoUpdate({
      target: notificationPreferences.profileId,
      set: { leaseRenewalEmail: prefs.lease_renewal, paymentDueEmail: prefs.payment_due, updatedAt: now },
      setWhere: eq(notificationPreferences.orgId, orgId),
    });
}
