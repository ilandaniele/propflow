/**
 * Attribution parsing (decision 11 of handoffs/phase2-blueprint.md). Pure
 * functions, no DB access — callers resolve `refCode` against `listings`
 * themselves (org-scoped).
 */

import type { AgentAttribution } from '@/lib/agent/types';

/**
 * Parses a Meta `referral` object (click-to-WhatsApp ad attribution) into our
 * shared AgentAttribution shape, minus `capturedAt` (the caller stamps that).
 * Requires `source_id` or `ctwa_clid` — anything else is not attributable.
 */
export function parseCtwaReferral(raw: Record<string, unknown> | null): Omit<AgentAttribution, 'capturedAt'> | null {
  if (!raw) return null;

  const sourceId = typeof raw.source_id === 'string' ? raw.source_id : null;
  const ctwaClid = typeof raw.ctwa_clid === 'string' ? raw.ctwa_clid : null;
  if (!sourceId && !ctwaClid) return null;

  return {
    type: 'ctwa',
    sourceId,
    sourceType: typeof raw.source_type === 'string' ? raw.source_type : null,
    sourceUrl: typeof raw.source_url === 'string' ? raw.source_url : null,
    headline: typeof raw.headline === 'string' ? raw.headline : null,
    ctwaClid,
    refCode: null,
    listingId: null,
  };
}

// Matches "REF ABC123", "ref:ABC-123", "ref#ABC123", "ref-ABC123" etc.
// DEVIATION from the literal regex in blueprint decision 0.11
// (`/\bref[\s:#-]*([A-Z0-9][A-Z0-9-]{2,19})\b/i`): that pattern has no word
// boundary after "ref", so it also matches inside plain words like
// "referencia" (captures "erencia"), which decision 0.11's own intent and
// section 4's required test ("false positives such as 'referencia'")
// contradict. Adding `\b` right after "ref" keeps every documented
// separator format (space/:/#/-) working while rejecting "ref" as a prefix
// of a longer word.
const REF_CODE_RE = /\bref\b[\s:#-]*([A-Z0-9][A-Z0-9-]{2,19})\b/i;

/** Extracts a `ref` code from wa.me prefilled text, uppercased. Null if absent. */
export function extractRefCode(text: string | null): string | null {
  if (!text) return null;
  const match = text.match(REF_CODE_RE);
  if (!match) return null;
  return match[1].toUpperCase();
}
