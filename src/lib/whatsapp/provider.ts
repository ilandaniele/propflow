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

export interface InteractiveListRow {
  id:          string;  // reply ID sent back by user; must be unique per message
  title:       string;  // max 24 chars (Meta limit)
  description?: string; // max 72 chars (Meta limit)
}

export interface InteractiveListOpts {
  to:         string;              // E.164 phone (PII — never log)
  bodyText:   string;
  buttonText: string;               // label of the button that opens the list; max 20 chars
  rows:       InteractiveListRow[]; // max 10 rows (Meta limit)
}

export interface TemplateMessageOpts {
  to:            string; // E.164 phone (PII — never log)
  templateName:  string; // must be an approved Meta template name
  languageCode:  string; // e.g. 'es', 'es_PE'
  bodyParams?:   string[]; // positional {{1}}, {{2}}... substitutions for the body component
}

export interface ImageMessageOpts {
  to:       string; // E.164 phone (PII — never log)
  imageUrl: string; // publicly reachable HTTPS URL (e.g. a signed Tigris link)
  caption?: string;
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
   * Download an attachment from the provider and store it in Tigris storage.
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

  /**
   * Send a message with an interactive list (up to 10 rows) — used to offer
   * visit time slots. Only available on Meta provider.
   */
  sendInteractiveList?(orgId: string, opts: InteractiveListOpts): Promise<SendResult>;

  /**
   * Send an approved Meta message template — the only way to write outside
   * the 24-hour customer-service window.
   */
  sendTemplate?(orgId: string, opts: TemplateMessageOpts): Promise<SendResult>;

  /**
   * Send an image message (e.g. a listing's cover photo) by URL.
   */
  sendImage?(orgId: string, opts: ImageMessageOpts): Promise<SendResult>;

  /**
   * Verify the GET webhook handshake's `hub.verify_token` query param.
   * Used by GET /api/whatsapp/webhook to answer Meta's subscription challenge.
   */
  verifyWebhookToken?(token: string): boolean;
}
