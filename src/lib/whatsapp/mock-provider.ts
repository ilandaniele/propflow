/**
 * MockWhatsAppProvider — IC3 default implementation.
 * Writes outbound messages to DB only. No network calls.
 * Signature validation uses WHATSAPP_WEBHOOK_SECRET.
 */

import crypto from 'crypto';
import { log } from '@/lib/log';
import type { IWhatsAppProvider, OutboundMessage, SendResult } from './provider';

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
}
