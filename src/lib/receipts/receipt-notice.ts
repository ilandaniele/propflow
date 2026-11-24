import { after } from 'next/server';
import { headers } from 'next/headers';
import { and, eq } from 'drizzle-orm';
import { createTranslator } from 'next-intl';
import type Messages from '@/messages/es.json';
import { db } from '@/lib/db';
import { notificationInbox, payments, tenants } from '@/lib/db/schema';
import { env } from '@/lib/env';
import { log } from '@/lib/log';
import { DEFAULT_LOCALE, isValidLocale } from '@/i18n/config';
import { buildPaymentReceiptEmail, sendEmail } from '@/lib/notifications/email';
import { loadPaymentReceipt } from './payment-receipt';
import { formatReceiptAmount } from './format';

async function loadRecipient(orgId: string, paymentId: string) {
  const [row] = await db
    .select({ email: tenants.email, profileId: tenants.profileId, language: tenants.preferredLanguage })
    .from(payments)
    .innerJoin(tenants, and(eq(tenants.id, payments.tenantId), eq(tenants.orgId, orgId)))
    .where(and(eq(payments.id, paymentId), eq(payments.orgId, orgId)))
    .limit(1);
  return row ?? null;
}

async function receiptTranslator(language: string) {
  const locale = isValidLocale(language) ? language : DEFAULT_LOCALE;
  const messages = (await import(`@/messages/${locale}.json`)).default as typeof Messages;
  return createTranslator({ locale, messages, namespace: 'paymentReceipt.email' });
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export async function sendReceiptNotice(orgId: string, paymentId: string, requestId: string): Promise<void> {
  try {
    const [recipient, receipt] = await Promise.all([loadRecipient(orgId, paymentId), loadPaymentReceipt(orgId, paymentId)]);
    if (!recipient || !receipt) return;

    const t = await receiptTranslator(recipient.language);
    const values = { number: receipt.number, amount: formatReceiptAmount(receipt), name: receipt.tenantName };

    if (recipient.profileId) {
      await db.insert(notificationInbox).values({
        orgId,
        profileId: recipient.profileId,
        type: 'payment_receipt',
        title: t('inboxTitle'),
        body: t('inboxBody', values),
        relatedType: 'payment',
        relatedId: paymentId,
      }).catch((e) => log.error('[receipt-notice] inbox insert failed', { requestId, paymentId, error: errorMessage(e) }));
    }

    if (!recipient.email) {
      log.info('[receipt-notice] tenant has no email, skipped', { requestId, paymentId });
      return;
    }

    const { subject, html } = buildPaymentReceiptEmail({
      subject: t('subject', values),
      greeting: t('greeting', values),
      body: t('body', values),
      cta: t('cta'),
      portalUrl: `${env.NEXT_PUBLIC_SITE_URL}/portal/payments`,
    });
    const result = await sendEmail({ to: recipient.email, subject, html, context: 'payment_receipt' });
    if (!result.success) log.error('[receipt-notice] email failed', { requestId, paymentId, error: result.error });
  } catch (e) {
    log.error('[receipt-notice] failed', { requestId, paymentId, error: errorMessage(e) });
  }
}

async function currentRequestId(): Promise<string> {
  try {
    return (await headers()).get('cf-ray') ?? crypto.randomUUID();
  } catch {
    return crypto.randomUUID();
  }
}

export async function scheduleReceiptNotice(orgId: string, paymentId: string): Promise<void> {
  const requestId = await currentRequestId();
  const run = () => sendReceiptNotice(orgId, paymentId, requestId);
  try {
    after(run);
  } catch {
    void run();
  }
}
