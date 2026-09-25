/**
 * Vapi server-event + assistant types.
 *
 * NOTE (item A "Override", see also handoffs/phase8-9-blueprint.md's Override
 * section): this environment has no outbound web access, so these were NOT
 * checked live against docs.vapi.ai as the blueprint's §0 asked. Kept
 * deliberately permissive (zod `.passthrough()`, optional/`unknown` fields
 * everywhere) so an unexpected/renamed field from Vapi never throws before
 * B's webhook handler gets a chance to read what it needs. Before going
 * live, re-verify every field name in this file (message.type values,
 * call.phoneNumberId, tool-calls' toolCallList shape, end-of-call-report's
 * artifact/analysis field names) against the current docs.vapi.ai server
 * events reference and adjust; add a fixture per real payload under
 * tests/fixtures/vapi/*.json (item B).
 */

import { z } from 'zod';

// ─────────────────────────────────────────────────────────────────────────────
// Inbound (server -> us): POST /api/agent/voice/vapi
// ─────────────────────────────────────────────────────────────────────────────

export const VapiCallSchema = z
  .object({
    id: z.string(),
    phoneNumberId: z.string().nullable().optional(),
    customer: z.object({ number: z.string().nullable().optional() }).passthrough().nullable().optional(),
    metadata: z.record(z.string()).nullable().optional(),
  })
  .passthrough();

export const VapiToolCallSchema = z
  .object({
    id: z.string(),
    type: z.literal('function').optional(),
    function: z.object({ name: z.string(), arguments: z.unknown() }).passthrough(),
  })
  .passthrough();

/**
 * message.type covers (per the blueprint's decision 4 verification note):
 * 'assistant-request' | 'tool-calls' | 'status-update' | 'end-of-call-report'
 * | anything else Vapi adds later (passed through, handled as a 200 {} no-op).
 */
export const VapiServerMessageSchema = z
  .object({
    type: z.string(),
    call: VapiCallSchema.nullable().optional(),
    status: z.string().nullable().optional(),
    endedReason: z.string().nullable().optional(),
    durationSeconds: z.number().nullable().optional(),
    transcript: z.string().nullable().optional(),
    recordingUrl: z.string().nullable().optional(),
    summary: z.string().nullable().optional(),
    cost: z.number().nullable().optional(),
    costBreakdown: z.unknown().nullable().optional(),
    // 'tool-calls' — Vapi's actual shape nests these under toolCallList /
    // toolWithToolCallList depending on API version; both are accepted so B's
    // handler can read whichever is present.
    toolCallList: z.array(VapiToolCallSchema).nullable().optional(),
    toolCalls: z.array(VapiToolCallSchema).nullable().optional(),
  })
  .passthrough();

export type VapiServerMessage = z.infer<typeof VapiServerMessageSchema>;

export const VapiWebhookBodySchema = z
  .object({
    message: VapiServerMessageSchema,
  })
  .passthrough();

// ─────────────────────────────────────────────────────────────────────────────
// Outbound (us -> Vapi): the transient assistant object returned from
// assistant-request, and the POST /call body for outbound dials.
// ─────────────────────────────────────────────────────────────────────────────

export interface VapiFunctionToolDef {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export interface VapiAssistant {
  firstMessage: string;
  model: {
    provider: 'anthropic';
    model: string;
    maxTokens: number;
    messages: Array<{ role: 'system'; content: string }>;
    tools?: VapiFunctionToolDef[];
  };
  voice: { provider: string; voiceId: string };
  transcriber: { provider: 'deepgram'; model: string; language: string };
  artifactPlan?: { recordingEnabled: boolean };
  maxDurationSeconds: number;
  endCallFunctionEnabled?: boolean;
  serverMessages?: string[];
  server?: { url: string };
  metadata?: Record<string, string>;
  analysisPlan?: { summaryPrompt?: string };
}
