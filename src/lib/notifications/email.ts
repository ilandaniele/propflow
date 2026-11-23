/**
 * Email notification wrapper — IC-C1 (Resend)
 *
 * SERVER-ONLY: never import in 'use client' components.
 * API key and from-address are server-only env vars (never NEXT_PUBLIC_*).
 *
 * All email content is server-templated; no user-controlled HTML is injected.
 * Sign links carry only the opaque token; no session material in emails.
 * Email send failures are logged and retried on the next cron run (bounded).
 */

import { assertServerEnv } from '@/lib/env';
import { log } from '@/lib/log';

const RESEND_EMAILS_URL = 'https://api.resend.com/emails';
const RESEND_TIMEOUT_MS = 10_000;

function getApiKey(): string {
  return assertServerEnv('RESEND_API_KEY', 'email sending');
}

function getFromAddress(): string {
  return assertServerEnv('RESEND_FROM_EMAIL', 'email sending');
}

export interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  /** Used only for log audit — no PII beyond email domain */
  context?: string;
}

export interface SendEmailResult {
  success: boolean;
  error?: string;
}

/**
 * Send a transactional email via Resend.
 * Returns success/failure — does NOT throw (caller handles retry logic).
 */
export async function sendEmail(opts: SendEmailOptions): Promise<SendEmailResult> {
  try {
    const apiKey = getApiKey();
    const from = getFromAddress();
    const response = await fetch(RESEND_EMAILS_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: opts.to, subject: opts.subject, html: opts.html }),
      signal: AbortSignal.timeout(RESEND_TIMEOUT_MS),
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { name?: string } | null;
      const code = body?.name ?? 'application_error';
      log.error('[email] send failed', { context: opts.context, code });
      return { success: false, error: code };
    }

    log.info('[email] sent', { context: opts.context, toDomain: opts.to.split('@')[1] });
    return { success: true };
  } catch (e) {
    // IC-A10: fail-closed on any exception; no stack trace to caller
    const msg = e instanceof Error ? e.message : 'unknown';
    log.error('[email] exception', { context: opts.context, error: msg });
    return { success: false, error: 'send_exception' };
  }
}

/** Build a signature-request email body. No user-controlled HTML. */
export function buildSignatureRequestEmail(opts: {
  signerName: string;
  propertyAddress: string;
  signUrl: string;
  expiresAt: Date;
}): { subject: string; html: string } {
  const expiryStr = opts.expiresAt.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  return {
    subject: 'Signature Required — PropFlow Contract',
    html: `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#1e293b">
  <h1 style="font-size:20px;margin-bottom:8px">Signature Required</h1>
  <p>Hello ${escapeHtml(opts.signerName)},</p>
  <p>You have been asked to sign a contract for <strong>${escapeHtml(opts.propertyAddress)}</strong>.</p>
  <p>Please review and sign by <strong>${expiryStr}</strong>:</p>
  <p style="margin:24px 0">
    <a href="${escapeHtml(opts.signUrl)}" style="background:#4f46e5;color:#fff;padding:12px 24px;text-decoration:none;border-radius:6px;display:inline-block">
      Sign Contract
    </a>
  </p>
  <p style="color:#64748b;font-size:14px">
    If the button above doesn't work, copy this link into your browser:<br>
    ${escapeHtml(opts.signUrl)}
  </p>
  <p style="color:#64748b;font-size:12px;margin-top:32px">
    This link expires on ${expiryStr} and can only be used once.
    If you did not expect this email, you can safely ignore it.
  </p>
</body>
</html>`,
  };
}

/** Build a reminder email body. */
export function buildReminderEmail(opts: {
  recipientName: string;
  type: 'lease_renewal' | 'payment_due' | 'custom';
  message: string;
  siteUrl: string;
}): { subject: string; html: string } {
  const subjectMap = {
    lease_renewal: 'Lease Renewal Reminder — PropFlow',
    payment_due: 'Payment Due Reminder — PropFlow',
    custom: 'Reminder — PropFlow',
  };
  return {
    subject: subjectMap[opts.type],
    html: `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#1e293b">
  <h1 style="font-size:20px;margin-bottom:8px">${subjectMap[opts.type]}</h1>
  <p>Hello ${escapeHtml(opts.recipientName)},</p>
  <p>${escapeHtml(opts.message)}</p>
  <p style="margin:24px 0">
    <a href="${escapeHtml(opts.siteUrl)}/portal" style="background:#4f46e5;color:#fff;padding:12px 24px;text-decoration:none;border-radius:6px;display:inline-block">
      Open Portal
    </a>
  </p>
  <p style="color:#64748b;font-size:12px;margin-top:32px">
    This is an automated reminder from PropFlow. Please log in to your tenant portal for details.
  </p>
</body>
</html>`,
  };
}

export function buildPaymentReceiptEmail(opts: {
  subject: string;
  greeting: string;
  body: string;
  cta: string;
  portalUrl: string;
}): { subject: string; html: string } {
  return {
    subject: opts.subject,
    html: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#1e293b">
  <h1 style="font-size:20px;margin-bottom:8px">${escapeHtml(opts.subject)}</h1>
  <p>${escapeHtml(opts.greeting)}</p>
  <p>${escapeHtml(opts.body)}</p>
  <p style="margin:24px 0">
    <a href="${escapeHtml(opts.portalUrl)}" style="background:#4f46e5;color:#fff;padding:12px 24px;text-decoration:none;border-radius:6px;display:inline-block">
      ${escapeHtml(opts.cta)}
    </a>
  </p>
</body>
</html>`,
  };
}

/** Minimal HTML escaping to prevent injection in email templates */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
