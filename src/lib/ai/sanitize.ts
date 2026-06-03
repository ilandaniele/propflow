/**
 * PII sanitization for LLM prompts — AC31 / LLM03 / LLM06
 *
 * SERVER-ONLY: never import this from client components.
 *
 * Rules:
 * - Strip any object key matching PII_KEY_PATTERN (recursive, depth-first)
 * - Strip string values containing email or phone patterns
 * - Only aggregate numeric values pass through
 * - Returns a JSON string safe for inclusion in system prompts
 */

/** Keys whose values are always redacted, regardless of type */
const PII_KEY_PATTERN = /email|phone|full_name|whatsapp_phone|name|address/i;

/** String value patterns that look like PII even on non-flagged keys */
const EMAIL_PATTERN = /\b[\w._%+-]+@[\w.-]+\.\w{2,}\b/g;
const PHONE_PATTERN = /\b\+?[\d][\d\s\-().]{6,}\d\b/g;

/**
 * Recursively strip PII fields from an arbitrary object.
 *
 * @param data  Any JSON-serializable value (object, array, primitive)
 * @returns     A sanitized copy — no mutation of the input
 */
export function stripPiiFields(data: unknown): unknown {
  if (data === null || data === undefined) return data;

  if (Array.isArray(data)) {
    return data.map(stripPiiFields);
  }

  if (typeof data === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
      if (PII_KEY_PATTERN.test(key)) {
        // Drop this key entirely — do not include even a redacted placeholder
        continue;
      }
      result[key] = stripPiiFields(value);
    }
    return result;
  }

  if (typeof data === 'string') {
    // Redact email and phone patterns within string values
    return data
      .replace(EMAIL_PATTERN, '[EMAIL]')
      .replace(PHONE_PATTERN, '[PHONE]');
  }

  // number, boolean — pass through (aggregates are safe)
  return data;
}

/**
 * Sanitize arbitrary data for safe inclusion in LLM prompts.
 *
 * 1. Recursively removes all keys matching PII_KEY_PATTERN (email, phone, full_name,
 *    whatsapp_phone, name, address).
 * 2. Redacts email/phone patterns within retained string values.
 * 3. Numeric aggregates pass through unchanged.
 *
 * @param data  Any value — object, array, primitive
 * @returns     A compact JSON string safe for prompt inclusion
 */
export function sanitizeForLLM(data: unknown): string {
  const sanitized = stripPiiFields(data);
  return JSON.stringify(sanitized);
}
