/**
 * E.164 phone normalization.
 *
 * Meta sends `from` without a leading '+' (e.g. "51987654321"). Every phone
 * number stored in this app (tenants.whatsapp_phone, whatsapp_conversations.
 * external_phone) is E.164 WITH the leading '+'. Without normalization, a
 * real tenant texting in from Meta would never match findTenantByPhone and
 * would be treated as a new prospect on every message.
 */

/** Normalize a phone number to E.164 with a leading '+'. PII — never log the result. */
export function toE164(phone: string): string {
  const trimmed = phone.trim();
  const digitsOnly = trimmed.replace(/[^\d+]/g, '');
  return digitsOnly.startsWith('+') ? digitsOnly : `+${digitsOnly}`;
}
