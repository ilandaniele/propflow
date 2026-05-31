/**
 * WhatsApp provider factory + singleton.
 * Returns MockWhatsAppProvider unless WHATSAPP_PROVIDER='meta' or 'twilio' is set.
 * Real provider implementations are single-file swaps.
 */

import type { IWhatsAppProvider } from './provider';
import { MockWhatsAppProvider } from './mock-provider';

let _provider: IWhatsAppProvider | null = null;

export function getWhatsAppProvider(): IWhatsAppProvider {
  if (_provider) return _provider;

  const providerName = process.env.WHATSAPP_PROVIDER ?? 'mock';

  if (providerName === 'mock') {
    _provider = new MockWhatsAppProvider();
  } else {
    // Future: import and instantiate real provider
    // For now, always fallback to mock
    _provider = new MockWhatsAppProvider();
  }

  return _provider;
}

// Re-export types for callers
export type { IWhatsAppProvider, OutboundMessage, InboundMessage, SendResult } from './provider';
