/**
 * MockWhatsAppProvider — IC3 default implementation.
 * Writes outbound messages to DB only. No network calls.
 * Signature validation uses WHATSAPP_WEBHOOK_SECRET.
 */

import crypto from 'crypto';
import { log } from '@/lib/log';
import type {
  IWhatsAppProvider,
  OutboundMessage,
  SendResult,
  InteractiveListOpts,
  TemplateMessageOpts,
  ImageMessageOpts,
} from './provider';

export class MockWhatsAppProvider implements IWhatsAppProvider {
  async sendMessage(orgId: string, message: OutboundMessage): Promise<SendResult> {
    // Mock: generate a fake provider_message_id and log (never log body — PII)
    const fakeId = `mock_${crypto.randomUUID()}`;
    log.info('[whatsapp:mock] sendMessage called', {
      orgId,
      // PII: phone number redacted from logs
      toPrefix: message.to.slice(0, 4) + '****',
      fakeId,
    });
    return { success: true, providerMessageId: fakeId };
  }

  validateWebhookSignature(rawBody: Buffer, signature: string): boolean {
    const secret = process.env.WHATSAPP_WEBHOOK_SECRET;
    if (!secret) return false;

    // signature format: "sha256=<hex>"
    const [algo, hex] = signature.split('=');
    if (algo !== 'sha256' || !hex) return false;

    const expected = crypto
      .createHmac('sha256', secret)
      .update(rawBody)
      .digest('hex');

    try {
      return crypto.timingSafeEqual(
        Buffer.from(hex, 'hex'),
        Buffer.from(expected, 'hex')
      );
    } catch {
      return false;
    }
  }

  async downloadAttachment(
    _orgId: string,
    attachmentUrl: string,
    _bucket: string,
    storagePath: string
  ): Promise<{ storagePath: string }> {
    // Mock: pretend the attachment is at a local fixture path
    log.info('[whatsapp:mock] downloadAttachment called', {
      attachmentUrl: attachmentUrl.slice(0, 30) + '...',
      storagePath,
    });
    // Return the storagePath as-is (caller should handle missing file gracefully)
    return { storagePath };
  }

  async sendInteractiveList(orgId: string, opts: InteractiveListOpts): Promise<SendResult> {
    const fakeId = `mock_${crypto.randomUUID()}`;
    log.info('[whatsapp:mock] sendInteractiveList called', { orgId, rowCount: opts.rows.length, fakeId });
    return { success: true, providerMessageId: fakeId };
  }

  async sendTemplate(orgId: string, opts: TemplateMessageOpts): Promise<SendResult> {
    const fakeId = `mock_${crypto.randomUUID()}`;
    log.info('[whatsapp:mock] sendTemplate called', { orgId, templateName: opts.templateName, fakeId });
    return { success: true, providerMessageId: fakeId };
  }

  async sendImage(orgId: string, opts: ImageMessageOpts): Promise<SendResult> {
    const fakeId = `mock_${crypto.randomUUID()}`;
    log.info('[whatsapp:mock] sendImage called', { orgId, hasCaption: !!opts.caption, fakeId });
    return { success: true, providerMessageId: fakeId };
  }

  /** Dev/test handshake: compares against WHATSAPP_WEBHOOK_VERIFY_TOKEN, same as the Meta provider. */
  verifyWebhookToken(token: string): boolean {
    const expected = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
    if (!expected) return false;
    const expectedBuf = Buffer.from(expected, 'utf8');
    const tokenBuf = Buffer.from(token, 'utf8');
    if (expectedBuf.length !== tokenBuf.length) return false;
    try {
      return crypto.timingSafeEqual(expectedBuf, tokenBuf);
    } catch {
      return false;
    }
  }
}
