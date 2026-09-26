import Anthropic from '@anthropic-ai/sdk';
import { assertServerEnv } from '@/lib/env';

/**
 * Shared Anthropic client + model config for the real-estate agent
 * (src/lib/agent/**). The other AI call sites (chat, executive-brief, OCR,
 * WhatsApp classify, task-proof) each construct their own client and are
 * intentionally left untouched here — migrating them is out of scope.
 */

let _client: Anthropic | null = null;

export function getAnthropicClient(): Anthropic {
  if (!_client) {
    _client = new Anthropic({ apiKey: assertServerEnv('ANTHROPIC_API_KEY', 'agent') });
  }
  return _client;
}

/** Reset the singleton (test isolation only). */
export function resetAnthropicClient(): void {
  _client = null;
}

export const AGENT_MODEL = process.env.AGENT_MODEL || 'claude-opus-5-5';
export const AGENT_VOICE_MODEL = process.env.AGENT_VOICE_MODEL || AGENT_MODEL;
