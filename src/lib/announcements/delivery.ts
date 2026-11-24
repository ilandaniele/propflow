import { and, count, eq, inArray, type SQL } from 'drizzle-orm';
import { createTranslator } from 'next-intl';
import type Messages from '@/messages/es.json';
import { db } from '@/lib/db';
import { announcementDeliveries, contracts, notificationPreferences, tenants, units } from '@/lib/db/schema';
import { asBatch, chunk, rowsPerInsert } from '@/lib/db/batch';
import { env } from '@/lib/env';
import { DEFAULT_LOCALE, isValidLocale } from '@/i18n/config';
import { buildPaymentReceiptEmail, sendEmail } from '@/lib/notifications/email';
import { getWhatsAppProvider } from '@/lib/whatsapp';
import {
  planDeliveries,
  tallyDeliveries,
  toTemplateParam,
  type DeliveryChannel,
  type DeliveryCounts,
  type RecipientRow,
} from './recipients';

export const ANNOUNCEMENT_TEMPLATE = 'comunicado_inquilinos';

/** Workers Free allows 50 outbound subrequests per request; the rest wait for "Continuar envío". */
export const SENDS_PER_RUN = 40;
const SEND_CONCURRENCY = 5;

export interface DeliverableAnnouncement {
  id: string;
  title: string;
  body: string;
  audience: string;
  propertyId: string | null;
  unitId: string | null;
}

function audienceFilter(ann: DeliverableAnnouncement): SQL | undefined | null {
  if (ann.audience === 'property') return ann.propertyId ? eq(units.propertyId, ann.propertyId) : null;
  if (ann.audience === 'unit') return ann.unitId ? eq(contracts.unitId, ann.unitId) : null;
  return undefined;
}

/** Tenants with an active contract in the announcement's audience, with their contact consent. One query. */
export async function loadRecipients(orgId: string, ann: DeliverableAnnouncement): Promise<RecipientRow[]> {
  const filter = audienceFilter(ann);
  if (filter === null) return [];
  return db
    .selectDistinct({
      tenantId:           tenants.id,
      email:              tenants.email,
      whatsappPhone:      tenants.whatsappPhone,
      whatsappOptIn:      tenants.whatsappOptIn,
      announcementsEmail: notificationPreferences.announcementsEmail,
    })
    .from(tenants)
    .innerJoin(contracts, and(eq(contracts.tenantId, tenants.id), eq(contracts.orgId, orgId), eq(contracts.status, 'active')))
    .innerJoin(units, and(eq(units.id, contracts.unitId), eq(units.orgId, orgId)))
    .leftJoin(notificationPreferences, and(eq(notificationPreferences.profileId, tenants.profileId), eq(notificationPreferences.orgId, orgId)))
    .where(and(eq(tenants.orgId, orgId), filter));
}

/** Inserts pending rows; a tenant already queued for a channel is never queued twice. */
export async function enqueueDeliveries(orgId: string, ann: DeliverableAnnouncement, channels: readonly DeliveryChannel[]): Promise<void> {
  const planned = planDeliveries(await loadRecipients(orgId, ann), channels);
  const statements = chunk(planned, rowsPerInsert(announcementDeliveries)).map((rows) =>
    db
      .insert(announcementDeliveries)
      .values(rows.map((row) => ({ orgId, announcementId: ann.id, tenantId: row.tenantId, channel: row.channel })))
      .onConflictDoNothing(),
  );
  const batch = asBatch(statements);
  if (batch) await db.batch(batch);
}

type EmailTranslator = ReturnType<typeof createTranslator<typeof Messages, 'announcements.email'>>;
const translators = new Map<string, Promise<EmailTranslator>>();

function emailTranslator(language: string): Promise<EmailTranslator> {
  const locale = isValidLocale(language) ? language : DEFAULT_LOCALE;
  let translator = translators.get(locale);
  if (!translator) {
    translator = import(`@/messages/${locale}.json`).then((module) =>
      createTranslator({ locale, messages: module.default as typeof Messages, namespace: 'announcements.email' }),
    );
    translators.set(locale, translator);
  }
  return translator;
}

interface PendingDelivery {
  id: string;
  channel: string;
  fullName: string;
  email: string | null;
  whatsappPhone: string | null;
  language: string;
}

type Outcome = { id: string; status: 'sent' | 'failed'; error: string | null };

async function sendOne(orgId: string, ann: DeliverableAnnouncement, row: PendingDelivery): Promise<Outcome> {
  const fail = (error: string): Outcome => ({ id: row.id, status: 'failed', error });

  if (row.channel === 'email') {
    if (!row.email) return fail('no_email');
    const t = await emailTranslator(row.language);
    const { subject, html } = buildPaymentReceiptEmail({
      subject: t('subject', { title: ann.title }),
      greeting: t('greeting', { name: row.fullName }),
      body: ann.body,
      cta: t('cta'),
      portalUrl: `${env.NEXT_PUBLIC_SITE_URL}/portal/announcements`,
    });
    const result = await sendEmail({ to: row.email, subject, html, context: 'announcement' });
    return result.success ? { id: row.id, status: 'sent', error: null } : fail(result.error ?? 'send_failed');
  }

  const provider = getWhatsAppProvider();
  if (!row.whatsappPhone) return fail('no_phone');
  if (!provider.sendTemplate) return fail('template_unsupported');
  const result = await provider.sendTemplate(orgId, {
    to: row.whatsappPhone,
    templateName: ANNOUNCEMENT_TEMPLATE,
    languageCode: 'es',
    bodyParams: [toTemplateParam(row.fullName, 60), toTemplateParam(ann.title, 200), toTemplateParam(ann.body, 700)],
  });
  return result.success ? { id: row.id, status: 'sent', error: null } : fail(result.error ?? 'send_failed');
}

/** Sends up to SENDS_PER_RUN pending deliveries of the announcement, then records each outcome. */
export async function processPendingDeliveries(orgId: string, ann: DeliverableAnnouncement): Promise<void> {
  const pending = await db
    .select({
      id:            announcementDeliveries.id,
      channel:       announcementDeliveries.channel,
      fullName:      tenants.fullName,
      email:         tenants.email,
      whatsappPhone: tenants.whatsappPhone,
      language:      tenants.preferredLanguage,
    })
    .from(announcementDeliveries)
    .innerJoin(tenants, and(eq(tenants.id, announcementDeliveries.tenantId), eq(tenants.orgId, orgId)))
    .where(and(
      eq(announcementDeliveries.orgId, orgId),
      eq(announcementDeliveries.announcementId, ann.id),
      eq(announcementDeliveries.status, 'pending'),
    ))
    .limit(SENDS_PER_RUN);

  const outcomes: Outcome[] = [];
  for (const group of chunk(pending, SEND_CONCURRENCY)) {
    outcomes.push(...(await Promise.all(group.map((row) => sendOne(orgId, ann, row).catch(() => ({ id: row.id, status: 'failed' as const, error: 'send_exception' }))))));
  }

  const idsByOutcome = new Map<string, Outcome[]>();
  for (const outcome of outcomes) {
    const key = `${outcome.status}:${outcome.error ?? ''}`;
    idsByOutcome.set(key, [...(idsByOutcome.get(key) ?? []), outcome]);
  }
  const now = new Date();
  const batch = asBatch([...idsByOutcome.values()].map((group) =>
    db
      .update(announcementDeliveries)
      .set({ status: group[0].status, error: group[0].error, updatedAt: now })
      .where(and(eq(announcementDeliveries.orgId, orgId), inArray(announcementDeliveries.id, group.map((o) => o.id)))),
  ));
  if (batch) await db.batch(batch);
}

/** Delivery counts per announcement and channel, for the admin list. One query. */
export async function loadDeliveryCounts(orgId: string, announcementIds: string[]): Promise<Map<string, DeliveryCounts>> {
  if (announcementIds.length === 0) return new Map();
  const rows = await db
    .select({
      announcementId: announcementDeliveries.announcementId,
      channel:        announcementDeliveries.channel,
      status:         announcementDeliveries.status,
      total:          count(),
    })
    .from(announcementDeliveries)
    .where(and(eq(announcementDeliveries.orgId, orgId), inArray(announcementDeliveries.announcementId, announcementIds)))
    .groupBy(announcementDeliveries.announcementId, announcementDeliveries.channel, announcementDeliveries.status);
  return tallyDeliveries(rows);
}
