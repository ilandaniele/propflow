import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { runWorkersAiToolLoop, type LoopTool } from '@/lib/ai/workers-ai-tool-loop';

function chatResponse(message: Record<string, unknown>, usage = { prompt_tokens: 10, completion_tokens: 5 }) {
  return new Response(JSON.stringify({ choices: [{ message }], usage }), { status: 200 });
}

function makeTool(name: string, run: (input: unknown) => string): LoopTool {
  return {
    name,
    description: `${name} tool`,
    input_schema: { type: 'object', properties: { q: { type: 'string' } } },
    parse: (x: unknown) => x,
    run,
  };
}

describe('runWorkersAiToolLoop', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubEnv('WORKERS_AI_ACCOUNT_ID', 'acc');
    vi.stubEnv('WORKERS_AI_API_TOKEN', 'tok');
    vi.stubEnv('AGENT_WORKERS_AI_MODEL', 'model-x');
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('runs a tool call then returns the final text, in Anthropic message format', async () => {
    const search = vi.fn(() => 'two flats');
    fetchMock
      .mockResolvedValueOnce(
        chatResponse({
          content: null,
          tool_calls: [{ id: 'c1', type: 'function', function: { name: 'search', arguments: '{"q":"miraflores"}' } }],
        }),
      )
      .mockResolvedValueOnce(chatResponse({ content: 'Tengo dos departamentos.' }));

    const result = await runWorkersAiToolLoop({
      system: 'be nice',
      tools: [makeTool('search', search)],
      messages: [{ role: 'user', content: 'hola' }],
      maxIterations: 8,
      maxTokens: 512,
    });

    expect(search).toHaveBeenCalledWith({ q: 'miraflores' });
    expect(result.messages).toEqual([
      { role: 'user', content: 'hola' },
      { role: 'assistant', content: [{ type: 'tool_use', id: 'c1', name: 'search', input: { q: 'miraflores' } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'c1', content: 'two flats', is_error: false }] },
      { role: 'assistant', content: [{ type: 'text', text: 'Tengo dos departamentos.' }] },
    ]);
    expect(result.finalContent).toEqual([{ type: 'text', text: 'Tengo dos departamentos.' }]);
    expect(result.totalInputTokens).toBe(20);
    expect(result.totalOutputTokens).toBe(10);

    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe('https://api.cloudflare.com/client/v4/accounts/acc/ai/v1/chat/completions');
    expect(init.headers.Authorization).toBe('Bearer tok');
    const body = JSON.parse(init.body);
    expect(body.model).toBe('model-x');
    expect(body.messages).toEqual([
      { role: 'system', content: 'be nice' },
      { role: 'user', content: 'hola' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [{ id: 'c1', type: 'function', function: { name: 'search', arguments: '{"q":"miraflores"}' } }],
      },
      { role: 'tool', tool_call_id: 'c1', content: 'two flats' },
    ]);
    expect(body.tools[0]).toEqual({
      type: 'function',
      function: { name: 'search', description: 'search tool', parameters: { type: 'object', properties: { q: { type: 'string' } } } },
    });
  });

  it('reports unknown tools and tool errors back to the model as errors', async () => {
    fetchMock
      .mockResolvedValueOnce(
        chatResponse({
          tool_calls: [
            { function: { name: 'nope', arguments: {} } },
            { id: 'c2', function: { name: 'boom', arguments: '{}' } },
          ],
        }),
      )
      .mockResolvedValueOnce(chatResponse({ content: 'ok' }));

    const result = await runWorkersAiToolLoop({
      system: 's',
      tools: [makeTool('boom', () => { throw new Error('kaput'); })],
      messages: [{ role: 'user', content: 'x' }],
      maxIterations: 8,
      maxTokens: 512,
    });

    expect(result.messages[2]).toEqual({
      role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: 'call_0_0', content: expect.stringMatching(/^Error: /), is_error: true },
        { type: 'tool_result', tool_use_id: 'c2', content: 'Error: kaput', is_error: true },
      ],
    });
  });

  it('stops after maxIterations model calls', async () => {
    fetchMock.mockImplementation(async () =>
      chatResponse({ tool_calls: [{ id: 'c', function: { name: 'search', arguments: '{}' } }] }),
    );

    await runWorkersAiToolLoop({
      system: 's',
      tools: [makeTool('search', () => 'r')],
      messages: [{ role: 'user', content: 'x' }],
      maxIterations: 3,
      maxTokens: 512,
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('throws on a non-OK response', async () => {
    fetchMock.mockResolvedValueOnce(new Response('quota', { status: 429 }));
    await expect(
      runWorkersAiToolLoop({ system: 's', tools: [], messages: [{ role: 'user', content: 'x' }], maxIterations: 8, maxTokens: 512 }),
    ).rejects.toThrow('Workers AI HTTP 429');
  });
});
