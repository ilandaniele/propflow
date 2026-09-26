/**
 * Adapts the shared `betaZodTool` output (used by every AgentToolContext
 * channel) to Vapi's function-tool + tool-calls-webhook shapes. Voice never
 * runs through runAgentTurn's toolRunner — the tool-calls webhook calls
 * `tool.parse(args)` then `tool.run(parsed)` directly (blueprint §0.3).
 */

import type { BetaTool } from '@anthropic-ai/sdk/resources/beta';
import type { BetaRunnableTool } from '@anthropic-ai/sdk/lib/tools/BetaRunnableTool';
import { log } from '@/lib/log';
import type { VapiFunctionToolDef } from './vapi-types';

/**
 * Every tool this codebase builds (via betaZodTool — see AgentToolContext's
 * makers) is a `BetaTool`-shaped custom tool, not one of the SDK's built-in
 * client tools (bash/text-editor/memory/etc). BetaRunnableTool's declared
 * type is a union over all of those, so it doesn't expose `description`/
 * `input_schema` without narrowing — this alias documents the narrower
 * shape we actually receive everywhere in this codebase.
 */
export type VoiceCompatibleTool = BetaTool & BetaRunnableTool;

export type VapiFunctionTool = VapiFunctionToolDef;

export function toVapiFunctionTools(tools: VoiceCompatibleTool[]): VapiFunctionTool[] {
  return tools.map((t) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description ?? '',
      parameters: t.input_schema as Record<string, unknown>,
    },
  }));
}

/** Shown to the caller when a tool times out — kept as one constant so B's webhook and the prompt (VOICE_RULES) agree on the wording. */
export const VOICE_TOOL_TIMEOUT = 'No pude verificarlo ahora; ofrecé que un asesor lo llame';

/**
 * Tools with side effects. Racing these against a timeout is unsafe — if the
 * timeout "wins" the race, the underlying mutation (book/cancel a visit, opt
 * a lead out of calls, hand off to a human, etc.) may still complete in the
 * background with nobody able to observe or react to its actual result. They
 * are still bounded by the overall per-call budget (checked before starting),
 * but once started they're awaited to completion instead of raced.
 */
const MUTATING_TOOL_NAMES = new Set([
  'book_visit',
  'reschedule_visit',
  'cancel_visit',
  'handoff_to_human',
  'opt_out_of_calls',
  'confirm_my_visit',
  'update_lead_profile',
  'register_owner_lead',
]);

function toolResultText(result: string | Array<{ type: string; text?: string }>): string {
  if (typeof result === 'string') return result;
  return result
    .filter((b): b is { type: string; text: string } => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('\n');
}

/**
 * Runs a single voice tool call within `deadlineMs`. Never throws — every
 * failure mode maps to a short spoken-safe string, so the caller (B's
 * handleToolCalls) can always build `{ results: [...] }` without its own
 * try/catch per call.
 */
export async function runVoiceToolCall(
  tools: VoiceCompatibleTool[],
  call: { id: string; name: string; arguments: unknown },
  deadlineMs: number,
): Promise<{ toolCallId: string; result: string }> {
  const tool = tools.find((t) => t.name === call.name);
  if (!tool) {
    return { toolCallId: call.id, result: 'Herramienta no disponible' };
  }

  let rawArgs: unknown = call.arguments;
  if (typeof rawArgs === 'string') {
    try {
      rawArgs = rawArgs.trim() === '' ? {} : JSON.parse(rawArgs);
    } catch {
      return { toolCallId: call.id, result: 'Parámetros inválidos' };
    }
  }

  let parsedArgs: unknown;
  try {
    parsedArgs = tool.parse(rawArgs);
  } catch {
    return { toolCallId: call.id, result: 'Parámetros inválidos' };
  }

  const budget = Math.max(0, deadlineMs);

  if (MUTATING_TOOL_NAMES.has(call.name)) {
    // Bounded by the overall budget check up front, but never raced once
    // started — a mutation must run to completion, win or lose.
    if (budget <= 0) {
      return { toolCallId: call.id, result: VOICE_TOOL_TIMEOUT };
    }
    try {
      const outcome = await tool.run(parsedArgs);
      return { toolCallId: call.id, result: toolResultText(outcome) };
    } catch (err) {
      log.error('[agent/voice/tool-adapter] tool run failed', { name: call.name, error: err instanceof Error ? err.message : 'unknown' });
      return { toolCallId: call.id, result: 'No pude completar esa acción ahora. Un asesor puede ayudarte.' };
    }
  }

  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<'timeout'>((resolve) => {
    timeoutHandle = setTimeout(() => resolve('timeout'), budget);
  });

  try {
    const outcome = await Promise.race([tool.run(parsedArgs), timeout]);
    if (outcome === 'timeout') {
      return { toolCallId: call.id, result: VOICE_TOOL_TIMEOUT };
    }
    return { toolCallId: call.id, result: toolResultText(outcome) };
  } catch (err) {
    log.error('[agent/voice/tool-adapter] tool run failed', { name: call.name, error: err instanceof Error ? err.message : 'unknown' });
    return { toolCallId: call.id, result: 'No pude completar esa acción ahora. Un asesor puede ayudarte.' };
  } finally {
    clearTimeout(timeoutHandle);
  }
}
