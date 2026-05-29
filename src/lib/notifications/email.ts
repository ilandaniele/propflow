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

import { Resend } from 'resend';
import { assertServerEnv } from '@/lib/env';
import { log } from '@/lib/log';

function getResend(): Resend {
  const apiKey = assertServerEnv('RESEND_API_KEY', 'email sending');
  return new Resend(apiKey);
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
    const resend = getResend();
    const from = getFromAddress();
    const { error } = await resend.emails.send({
      from,
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
    });

    if (error) {
      log.error('[email] send failed', { context: opts.context, code: error.name });
      return { success: false, error: error.name };
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

/** Minimal HTML escaping to prevent injection in email templates */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
