/**
 * IWhatsAppProvider interface — IC3.
 * Swap MockWhatsAppProvider for a real provider (Meta/Twilio) by implementing this interface
 * and returning it from getWhatsAppProvider() in index.ts.
 */

export interface OutboundMessage {
  to: string;           // E.164 phone number
  body: string;         // plain text body (PII — never log)
  templateName?: string;
  templateParams?: Record<string, string>;
}

export interface InboundMessage {
  providerMessageId: string;  // unique ID from provider
  from: string;               // E.164 phone number (PII — never log)
  to: string;                 // receiving number
  type: 'text' | 'image' | 'document' | 'audio' | 'video';
  body?: string;              // text content (PII — never log)
  attachmentUrl?: string;     // URL to download attachment from provider
  timestamp: string;          // ISO8601
}

export interface SendResult {
  success: boolean;
  providerMessageId?: string;
  error?: string;
}

export interface InteractiveButton {
  id: string;     // reply ID sent back by user; max 256 chars; must be unique per message
  title: string;  // displayed label; max 20 chars (Meta limit)
}

export interface InteractiveButtonOpts {
  to:       string;               // E.164 phone (PII — never log)
  bodyText: string;               // message body shown above buttons
  buttons:  InteractiveButton[];  // max 3 buttons (Meta limit)
}

export interface IWhatsAppProvider {
  /**
   * Send a plain text or template message.
   * Returns { success, providerMessageId } or { success: false, error }.
   */
  sendMessage(orgId: string, message: OutboundMessage): Promise<SendResult>;

  /**
   * Validate a webhook request signature.
   * Returns true if signature is valid, false otherwise.
   */
  validateWebhookSignature(rawBody: Buffer, signature: string): boolean;

  /**
   * Download an attachment from the provider and store it in Supabase storage.
   * Returns the storage path or throws on error.
   */
  downloadAttachment(
    orgId: string,
    attachmentUrl: string,
    bucket: string,
    storagePath: string
  ): Promise<{ storagePath: string }>;

  /**
   * Send a message with interactive quick-reply buttons (optional capability).
   * Validates buttons count (max 3) and title length (max 20 chars) before sending.
   * Only available on Meta provider — MockWhatsAppProvider stubs this as a no-op.
   */
  sendInteractiveButtons?(orgId: string, opts: InteractiveButtonOpts): Promise<SendResult>;
}
