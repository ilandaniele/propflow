import { describe, it, expect, vi } from 'vitest';
import { toVapiFunctionTools, runVoiceToolCall, VOICE_TOOL_TIMEOUT } from '@/lib/agent/voice/tool-adapter';

function fakeTool(overrides: Partial<{ name: string; run: (...a: unknown[]) => unknown; parse: (a: unknown) => unknown }> = {}) {
  return {
    type: 'custom' as const,
    name: overrides.name ?? 'search_listings',
    description: 'desc',
    input_schema: { type: 'object', properties: {} },
    parse: overrides.parse ?? ((a: unknown) => a),
    run: overrides.run ?? (async () => 'ok'),
  };
}

describe('agent/voice/tool-adapter — toVapiFunctionTools', () => {
  it('maps name/description/input_schema to a Vapi function tool', () => {
    const tools = toVapiFunctionTools([fakeTool({ name: 'get_listing_details' }) as never]);
    expect(tools).toEqual([
      { type: 'function', function: { name: 'get_listing_details', description: 'desc', parameters: { type: 'object', properties: {} } } },
    ]);
  });
});

describe('agent/voice/tool-adapter — runVoiceToolCall', () => {
  it('parses string JSON arguments before calling tool.run', async () => {
    const run = vi.fn(async (args: unknown) => `got:${JSON.stringify(args)}`);
    const tool = fakeTool({ run });
    const result = await runVoiceToolCall([tool as never], { id: 't1', name: 'search_listings', arguments: '{"zone":"Miraflores"}' }, 6000);
    expect(result).toEqual({ toolCallId: 't1', result: 'got:{"zone":"Miraflores"}' });
  });

  it('accepts object arguments as-is (no JSON.parse)', async () => {
    const run = vi.fn(async (args: unknown) => `got:${JSON.stringify(args)}`);
    const tool = fakeTool({ run });
    const result = await runVoiceToolCall([tool as never], { id: 't1', name: 'search_listings', arguments: { zone: 'San Isidro' } }, 6000);
    expect(result.result).toBe('got:{"zone":"San Isidro"}');
  });

  it('returns "Parámetros inválidos" on malformed JSON string arguments', async () => {
    const tool = fakeTool();
    const result = await runVoiceToolCall([tool as never], { id: 't1', name: 'search_listings', arguments: '{not json' }, 6000);
    expect(result.result).toBe('Parámetros inválidos');
  });

  it('returns "Parámetros inválidos" when tool.parse throws (zod failure)', async () => {
    const tool = fakeTool({
      parse: () => {
        throw new Error('invalid');
      },
    });
    const result = await runVoiceToolCall([tool as never], { id: 't1', name: 'search_listings', arguments: {} }, 6000);
    expect(result.result).toBe('Parámetros inválidos');
  });

  it('returns "Herramienta no disponible" for a filtered/unknown tool name', async () => {
    const tool = fakeTool({ name: 'send_listing_photos' }); // whatsapp-only, not passed for voice
    const result = await runVoiceToolCall([tool as never], { id: 't1', name: 'continue_on_whatsapp', arguments: {} }, 6000);
    expect(result.result).toBe('Herramienta no disponible');
  });

  it('times out within the given budget and returns VOICE_TOOL_TIMEOUT', async () => {
    vi.useFakeTimers();
    const run = vi.fn(() => new Promise(() => {})); // never resolves
    const tool = fakeTool({ run });

    const promise = runVoiceToolCall([tool as never], { id: 't1', name: 'search_listings', arguments: {} }, 500);
    await vi.advanceTimersByTimeAsync(500);
    const result = await promise;

    expect(result).toEqual({ toolCallId: 't1', result: VOICE_TOOL_TIMEOUT });
    vi.useRealTimers();
  });

  it('maps a thrown error to a generic spoken-safe string, never leaking the error message', async () => {
    const run = vi.fn(async () => {
      throw new Error('sensitive internal detail');
    });
    const tool = fakeTool({ run });
    const result = await runVoiceToolCall([tool as never], { id: 't1', name: 'search_listings', arguments: {} }, 6000);
    expect(result.result).not.toContain('sensitive internal detail');
  });

  it('joins text content blocks from an array result', async () => {
    const run = vi.fn(async () => [
      { type: 'text', text: 'primera línea' },
      { type: 'text', text: 'segunda línea' },
    ]);
    const tool = fakeTool({ run });
    const result = await runVoiceToolCall([tool as never], { id: 't1', name: 'search_listings', arguments: {} }, 6000);
    expect(result.result).toBe('primera línea\nsegunda línea');
  });
});
