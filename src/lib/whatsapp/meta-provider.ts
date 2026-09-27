/**
 * MetaWhatsAppProvider — Meta WhatsApp Business Cloud API v22.0 implementation.
 *
 * Security (ASVS L2):
 * - WHATSAPP_ACCESS_TOKEN NEVER appears in any log statement (redacted to [REDACTED]).
 * - Phone numbers (E.164) NEVER appear in logs.
 * - Message bodies NEVER appear in logs.
 * - META_APP_SECRET NEVER appears in logs.
 * - Media URLs from Meta are never echoed back in admin responses.
 * - All env vars read at call-site (not module top-level) to prevent startup crash in preview.
 *
 * Retry policy (Meta guidance):
 * - 3 retries with exponential backoff on 5xx and 429.
 * - Delays: 250ms, 1s, 4s.
 * - Per-request timeout: 15s (AbortSignal.timeout).
 *
 * Interactive buttons (IC4):
 * - max 3 buttons, each title max 20 chars.
 * - Validation throws ValidationError BEFORE any network call.
 */

import crypto from 'crypto';
import { log } from '@/lib/log';
import { verifyMetaSignature } from './meta-signature';
import type {
  IWhatsAppProvider,
  OutboundMessage,
  SendResult,
  InteractiveButtonOpts,
  InteractiveListOpts,
  TemplateMessageOpts,
  ImageMessageOpts,
} from './provider';

// Exported so meta-templates-api.ts (Graph API template management, not message
// sending) hits the same host/version instead of hardcoding a second copy.
export const META_API_HOST = 'https://graph.facebook.com';
export const META_API_VERSION = 'v22.0';
const REQUEST_TIMEOUT_MS = 15_000;
const RETRY_DELAYS_MS = [250, 1_000, 4_000] as const;

// Custom error for pre-network validation failures (IC4)
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

function getAccessToken(): string {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!token) throw new Error('[meta-provider] WHATSAPP_ACCESS_TOKEN is not set');
  return token;
}

function getPhoneNumberId(): string {
  const id = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!id) throw new Error('[meta-provider] WHATSAPP_PHONE_NUMBER_ID is not set');
  return id;
}

/** Strip the leading '+' from an E.164 number (Meta requires no '+' in the `to` field). */
function normalisePhone(phone: string): string {
  return phone.startsWith('+') ? phone.slice(1) : phone;
}

/**
 * Send an HTTP POST to the Meta Graph API with retry logic.
 * Returns the parsed JSON response body or throws on non-retryable failure.
 */
async function metaPost(
  url: string,
  body: Record<string, unknown>,
  accessToken: string
): Promise<{ ok: boolean; status: number; data: unknown }> {
  let lastStatus = 0;
  let lastData: unknown = null;

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    if (attempt > 0) {
      const delay = RETRY_DELAYS_MS[attempt - 1];
      await new Promise((r) => setTimeout(r, delay));
    }

    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Security: accessToken is never logged — only passed as header
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (e) {
      // Network error / timeout
      log.warn('[meta-provider] fetch error', {
        attempt,
        error: e instanceof Error ? e.name : 'unknown',
        // Never log URL (may contain IDs), body (PII), or token
      });
      if (attempt < RETRY_DELAYS_MS.length) continue;
      throw new Error(`[meta-provider] Network error after ${attempt + 1} attempts`);
    }

    lastStatus = res.status;
    try {
      lastData = await res.json();
    } catch {
      lastData = null;
    }

    // Retry on 5xx or 429
    if ((res.status >= 500 || res.status === 429) && attempt < RETRY_DELAYS_MS.length) {
      log.warn('[meta-provider] retryable error', { attempt, status: res.status });
      continue;
    }

    return { ok: res.ok, status: res.status, data: lastData };
  }

  return { ok: false, status: lastStatus, data: lastData };
}

export class MetaWhatsAppProvider implements IWhatsAppProvider {
  constructor() {
    // Warn at boot if any required env var is missing — but do NOT throw,
    // so preview deployments that haven't set secrets continue to boot.
    const missing: string[] = [];
    if (!process.env.WHATSAPP_ACCESS_TOKEN)         missing.push('WHATSAPP_ACCESS_TOKEN');
    if (!process.env.WHATSAPP_PHONE_NUMBER_ID)      missing.push('WHATSAPP_PHONE_NUMBER_ID');
    if (!process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN) missing.push('WHATSAPP_WEBHOOK_VERIFY_TOKEN');
    if (!process.env.META_APP_SECRET)               missing.push('META_APP_SECRET');

    if (missing.length > 0) {
      log.warn('[meta-provider] missing required env vars — provider will fail at call-time', {
        missing, // Only var names, not values
      });
    }
  }

  async sendMessage(orgId: string, message: OutboundMessage): Promise<SendResult> {
    const accessToken  = getAccessToken();
    const phoneNumberId = getPhoneNumberId();

    const url = `${META_API_HOST}/${META_API_VERSION}/${phoneNumberId}/messages`;

    const requestBody = {
      messaging_product: 'whatsapp',
      to: normalisePhone(message.to),  // Strip leading '+' (IC1)
      type: 'text',
      text: { body: message.body },
      // body is PII — never logged
    };

    log.info('[meta-provider] sendMessage', {
      orgId,
      // Never log the phone number or body
      toRedacted: '[REDACTED]',
    });

    const { ok, status, data } = await metaPost(url, requestBody, accessToken);

    if (ok) {
      const responseData = data as { messages?: Array<{ id: string }> };
      const providerMessageId = responseData.messages?.[0]?.id;
      return { success: true, providerMessageId };
    }

    // Map Meta error code to our format
    const metaData = data as { error?: { code?: number; message?: string } } | null;
    const metaCode = metaData?.error?.code;
    const errorCode = metaCode ? `META_${metaCode}` : `META_HTTP_${status}`;

    log.warn('[meta-provider] sendMessage failed', {
      orgId,
      status,
      errorCode,
      // Never log error.message (may contain PII) or phone number
    });

    return { success: false, error: errorCode };
  }

  async sendInteractiveButtons(
    orgId: string,
    opts: InteractiveButtonOpts
  ): Promise<SendResult> {
    // Pre-network validation (IC4) — throw BEFORE any fetch
    if (opts.buttons.length > 3) {
      throw new ValidationError(
        `[meta-provider] sendInteractiveButtons: max 3 buttons allowed, got ${opts.buttons.length}`
      );
    }
    for (const btn of opts.buttons) {
      if (btn.title.length > 20) {
        throw new ValidationError(
          `[meta-provider] sendInteractiveButtons: button title max 20 chars (got ${btn.title.length})`
        );
      }
      if (btn.id.length > 256) {
        throw new ValidationError(
          `[meta-provider] sendInteractiveButtons: button id max 256 chars`
        );
      }
    }

    const accessToken   = getAccessToken();
    const phoneNumberId = getPhoneNumberId();
    const url = `${META_API_HOST}/${META_API_VERSION}/${phoneNumberId}/messages`;

    // Check for unique IDs
    const ids = opts.buttons.map((b) => b.id);
    if (new Set(ids).size !== ids.length) {
      throw new ValidationError('[meta-provider] sendInteractiveButtons: button ids must be unique');
    }

    const requestBody = {
      messaging_product: 'whatsapp',
      to: normalisePhone(opts.to),
      type: 'interactive',
      interactive: {
        type: 'button',
        body: { text: opts.bodyText },
        action: {
          buttons: opts.buttons.map((btn) => ({
            type: 'reply',
            reply: { id: btn.id, title: btn.title },
          })),
        },
      },
    };

    log.info('[meta-provider] sendInteractiveButtons', {
      orgId,
      buttonCount: opts.buttons.length,
      toRedacted: '[REDACTED]',
    });

    const { ok, status, data } = await metaPost(url, requestBody, accessToken);

    if (ok) {
      const responseData = data as { messages?: Array<{ id: string }> };
      const providerMessageId = responseData.messages?.[0]?.id;
      return { success: true, providerMessageId };
    }

    const metaData = data as { error?: { code?: number } } | null;
    const metaCode = metaData?.error?.code;
    const errorCode = metaCode ? `META_${metaCode}` : `META_HTTP_${status}`;

    log.warn('[meta-provider] sendInteractiveButtons failed', {
      orgId,
      status,
      errorCode,
    });

    return { success: false, error: errorCode };
  }

  async sendInteractiveList(orgId: string, opts: InteractiveListOpts): Promise<SendResult> {
    if (opts.rows.length > 10) {
      throw new ValidationError(
        `[meta-provider] sendInteractiveList: max 10 rows allowed, got ${opts.rows.length}`
      );
    }
    for (const row of opts.rows) {
      if (row.title.length > 24) {
        throw new ValidationError(`[meta-provider] sendInteractiveList: row title max 24 chars`);
      }
      if (row.description && row.description.length > 72) {
        throw new ValidationError(`[meta-provider] sendInteractiveList: row description max 72 chars`);
      }
    }
    const ids = opts.rows.map((r) => r.id);
    if (new Set(ids).size !== ids.length) {
      throw new ValidationError('[meta-provider] sendInteractiveList: row ids must be unique');
    }
    if (opts.buttonText.length > 20) {
      throw new ValidationError('[meta-provider] sendInteractiveList: buttonText max 20 chars');
    }

    const accessToken   = getAccessToken();
    const phoneNumberId = getPhoneNumberId();
    const url = `${META_API_HOST}/${META_API_VERSION}/${phoneNumberId}/messages`;

    const requestBody = {
      messaging_product: 'whatsapp',
      to: normalisePhone(opts.to),
      type: 'interactive',
      interactive: {
        type: 'list',
        body: { text: opts.bodyText },
        action: {
          button: opts.buttonText,
          sections: [
            {
              rows: opts.rows.map((r) => ({ id: r.id, title: r.title, description: r.description })),
            },
          ],
        },
      },
    };

    log.info('[meta-provider] sendInteractiveList', { orgId, rowCount: opts.rows.length, toRedacted: '[REDACTED]' });

    const { ok, status, data } = await metaPost(url, requestBody, accessToken);

    if (ok) {
      const responseData = data as { messages?: Array<{ id: string }> };
      return { success: true, providerMessageId: responseData.messages?.[0]?.id };
    }
    const metaData = data as { error?: { code?: number } } | null;
    const errorCode = metaData?.error?.code ? `META_${metaData.error.code}` : `META_HTTP_${status}`;
    log.warn('[meta-provider] sendInteractiveList failed', { orgId, status, errorCode });
    return { success: false, error: errorCode };
  }

  async sendTemplate(orgId: string, opts: TemplateMessageOpts): Promise<SendResult> {
    const accessToken   = getAccessToken();
    const phoneNumberId = getPhoneNumberId();
    const url = `${META_API_HOST}/${META_API_VERSION}/${phoneNumberId}/messages`;

    const requestBody = {
      messaging_product: 'whatsapp',
      to: normalisePhone(opts.to),
      type: 'template',
      template: {
        name: opts.templateName,
        language: { code: opts.languageCode },
        ...(opts.bodyParams?.length
          ? { components: [{ type: 'body', parameters: opts.bodyParams.map((text) => ({ type: 'text', text })) }] }
          : {}),
      },
    };

    log.info('[meta-provider] sendTemplate', { orgId, templateName: opts.templateName, toRedacted: '[REDACTED]' });

    const { ok, status, data } = await metaPost(url, requestBody, accessToken);

    if (ok) {
      const responseData = data as { messages?: Array<{ id: string }> };
      return { success: true, providerMessageId: responseData.messages?.[0]?.id };
    }
    const metaData = data as { error?: { code?: number } } | null;
    const errorCode = metaData?.error?.code ? `META_${metaData.error.code}` : `META_HTTP_${status}`;
    log.warn('[meta-provider] sendTemplate failed', { orgId, status, errorCode, templateName: opts.templateName });
    return { success: false, error: errorCode };
  }

  async sendImage(orgId: string, opts: ImageMessageOpts): Promise<SendResult> {
    const accessToken   = getAccessToken();
    const phoneNumberId = getPhoneNumberId();
    const url = `${META_API_HOST}/${META_API_VERSION}/${phoneNumberId}/messages`;

    const requestBody = {
      messaging_product: 'whatsapp',
      to: normalisePhone(opts.to),
      type: 'image',
      image: { link: opts.imageUrl, ...(opts.caption ? { caption: opts.caption } : {}) },
    };

    log.info('[meta-provider] sendImage', { orgId, toRedacted: '[REDACTED]' });

    const { ok, status, data } = await metaPost(url, requestBody, accessToken);

    if (ok) {
      const responseData = data as { messages?: Array<{ id: string }> };
      return { success: true, providerMessageId: responseData.messages?.[0]?.id };
    }
    const metaData = data as { error?: { code?: number } } | null;
    const errorCode = metaData?.error?.code ? `META_${metaData.error.code}` : `META_HTTP_${status}`;
    log.warn('[meta-provider] sendImage failed', { orgId, status, errorCode });
    return { success: false, error: errorCode };
  }

  validateWebhookSignature(rawBody: Buffer, signature: string): boolean {
    // For Meta provider, signature uses META_APP_SECRET (not WHATSAPP_WEBHOOK_SECRET).
    // Read at call-site to prevent startup crash when env not set (preview deployments).
    const secret = process.env.META_APP_SECRET;
    if (!secret) {
      log.warn('[meta-provider] META_APP_SECRET not configured — signature validation skipped');
      return false;
    }
    return verifyMetaSignature(rawBody, signature, secret);
  }

  async downloadAttachment(
    orgId: string,
    mediaId: string,           // The media ID from Meta (not a URL)
    bucket: string,
    storagePath: string
  ): Promise<{ storagePath: string }> {
    const accessToken = getAccessToken();

    // Step 1: Resolve media URL from Meta Graph API
    const metaUrl = `${META_API_HOST}/${META_API_VERSION}/${mediaId}`;
    let downloadUrl: string;
    try {
      const res = await fetch(metaUrl, {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!res.ok) {
        throw new Error(`[meta-provider] media URL resolve failed: HTTP ${res.status}`);
      }
      const json = (await res.json()) as { url?: string };
      if (!json.url) {
        throw new Error('[meta-provider] media URL missing in response');
      }
      downloadUrl = json.url;
    } catch (e) {
      log.error('[meta-provider] downloadAttachment resolve failed', {
        orgId,
        error: e instanceof Error ? e.message : 'unknown',
        // Never log media ID or accessToken
      });
      throw e;
    }

    // Step 2: Download the actual binary (URL also requires Bearer auth)
    let buffer: Buffer;
    try {
      const res = await fetch(downloadUrl, {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!res.ok) {
        throw new Error(`[meta-provider] media download failed: HTTP ${res.status}`);
      }
      buffer = Buffer.from(await res.arrayBuffer());
    } catch (e) {
      log.error('[meta-provider] downloadAttachment download failed', {
        orgId,
        error: e instanceof Error ? e.message : 'unknown',
        // Never log the download URL (may contain signed tokens)
      });
      throw e;
    }

    // Step 3: Upload to Tigris storage
    const { uploadFile } = await import('@/lib/storage');

    try {
      await uploadFile(bucket, storagePath, buffer, 'image/jpeg', false);
    } catch (uploadError) {
      log.error('[meta-provider] storage upload failed', {
        orgId,
        error: (uploadError as Error).message,
        bucket,
        // Never log storagePath if it contains org/tenant data
      });
      throw new Error(`[meta-provider] storage upload failed: ${(uploadError as Error).message}`);
    }

    log.info('[meta-provider] attachment downloaded and stored', {
      orgId,
      bucket,
      sizeBytes: buffer.length,
    });

    return { storagePath };
  }

  /**
   * Verify the Meta webhook GET handshake verify token.
   * Called separately from validateWebhookSignature (different auth mechanism).
   */
  verifyWebhookToken(token: string): boolean {
    const expected = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
    if (!expected) return false;

    const expectedBuf = Buffer.from(expected, 'utf8');
    const tokenBuf    = Buffer.from(token, 'utf8');

    if (expectedBuf.length !== tokenBuf.length) return false;

    try {
      return crypto.timingSafeEqual(expectedBuf, tokenBuf);
    } catch {
      return false;
    }
  }
}
