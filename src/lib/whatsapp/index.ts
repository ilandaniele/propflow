/**
 * WhatsApp provider factory + singleton.
 *
 * Selection logic:
 * - WHATSAPP_PROVIDER === 'meta' AND all 4 required env vars present
 *   → MetaWhatsAppProvider
 * - Otherwise → MockWhatsAppProvider (with a single boot warning if 'meta' was intended)
 *
 * WHATSAPP_BUSINESS_ACCOUNT_ID is optional at boot — only required in
 * downloadAttachment paths (asserted at call-site in MetaWhatsAppProvider).
 *
 * Preview deployments and local dev continue to boot even without
 * any WhatsApp secrets set. Never crash at module import time.
 */

import { log } from '@/lib/log';
import type { IWhatsAppProvider } from './provider';
import { MockWhatsAppProvider } from './mock-provider';
import { MetaWhatsAppProvider } from './meta-provider';

let _provider: IWhatsAppProvider | null = null;

export function getWhatsAppProvider(): IWhatsAppProvider {
  if (_provider) return _provider!;

  const providerName = process.env.WHATSAPP_PROVIDER ?? 'mock';

  if (
    providerName === 'meta' &&
    process.env.WHATSAPP_ACCESS_TOKEN &&
    process.env.WHATSAPP_PHONE_NUMBER_ID &&
    process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN &&
    process.env.META_APP_SECRET
  ) {
    // All required env vars present — use real Meta provider
    _provider = new MetaWhatsAppProvider();
    log.info('[whatsapp] using MetaWhatsAppProvider');
  } else {
    // Fall back to mock (preview / local dev / misconfiguration)
    _provider = new MockWhatsAppProvider();
    if (providerName === 'meta') {
      // Only warn if operator intended Meta but vars are missing
      log.warn('[whatsapp] WHATSAPP falling back to mock (WHATSAPP_PROVIDER env not fully configured)', {
        configured: false,
      });
    }
  }

  return _provider!;
}

/** Reset the singleton (test isolation only). */
export function resetWhatsAppProvider(): void {
  _provider = null;
}

// Re-export types for callers
export type {
  IWhatsAppProvider,
  OutboundMessage,
  InboundMessage,
  SendResult,
  InteractiveButtonOpts,
  InteractiveButton,
} from './provider';
