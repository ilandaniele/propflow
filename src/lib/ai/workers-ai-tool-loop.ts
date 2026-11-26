import type Anthropic from '@anthropic-ai/sdk';

type MessageParam = Anthropic.Beta.Messages.BetaMessageParam;
type ContentBlockParam = Anthropic.Beta.Messages.BetaContentBlockParam;
type ToolUseBlockParam = Anthropic.Beta.Messages.BetaToolUseBlockParam;
type ToolResultBlockParam = Anthropic.Beta.Messages.BetaToolResultBlockParam;

/** Structural subset of the SDK's BetaRunnableTool that this loop needs. */
export interface LoopTool {
  name: string;
  description?: string;
  input_schema?: unknown;
  parse: (input: unknown) => unknown;
  run: (input: never, context?: never) => unknown;
}

interface ChatResponse {
  choices?: { message?: { content?: string | null; tool_calls?: { id?: string; function?: { name?: string; arguments?: unknown } }[] } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

export interface ToolLoopArgs {
  system: string;
  tools: LoopTool[];
  messages: MessageParam[];
  maxIterations: number;
  maxTokens: number;
  stopAfterTool?: string;
}

export interface ToolLoopResult {
  messages: MessageParam[];
  finalContent: ContentBlockParam[];
  totalInputTokens: number;
  totalOutputTokens: number;
  costUsd: number;
}

const text = (content: unknown): string =>
  typeof content === 'string' ? content : Array.isArray(content) ? content.filter((b) => b.type === 'text').map((b) => b.text).join('\n') : '';

function toChatMessages(m: MessageParam): object[] {
  const blocks = typeof m.content === 'string' ? [] : m.content;
  const content = text(m.content);
  if (m.role === 'assistant') {
    const toolCalls = blocks.flatMap((b) =>
      b.type === 'tool_use' ? [{ id: b.id, type: 'function', function: { name: b.name, arguments: JSON.stringify(b.input) } }] : [],
    );
    return [{ role: m.role, content, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) }];
  }
  const results = blocks.flatMap((b) => (b.type === 'tool_result' ? [{ role: 'tool', tool_call_id: b.tool_use_id, content: text(b.content) }] : []));
  return content ? [...results, { role: m.role, content }] : results;
}

function parseArguments(raw: unknown): unknown {
  try {
    return typeof raw === 'string' ? JSON.parse(raw || '{}') : (raw ?? {});
  } catch {
    return {};
  }
}

async function callModel(args: ToolLoopArgs, messages: MessageParam[]): Promise<ChatResponse> {
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${process.env.WORKERS_AI_ACCOUNT_ID}/ai/v1/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.WORKERS_AI_API_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: process.env.AGENT_WORKERS_AI_MODEL,
      max_tokens: args.maxTokens,
      messages: [{ role: 'system', content: args.system }, ...messages.flatMap(toChatMessages)],
      tools: args.tools.map((t) => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.input_schema },
      })),
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`Workers AI HTTP ${res.status}`);
  return res.json();
}

async function runTool(tools: LoopTool[], call: ToolUseBlockParam): Promise<ToolResultBlockParam> {
  let content: unknown;
  let is_error = false;
  try {
    const tool = tools.find((t) => t.name === call.name)!;
    content = await tool.run(tool.parse(call.input) as never);
  } catch (e) {
    content = `Error: ${(e as Error).message}`;
    is_error = true;
  }
  return { type: 'tool_result', tool_use_id: call.id, content: typeof content === 'string' ? content : JSON.stringify(content), is_error };
}

/** Tool-use loop over Workers AI's OpenAI-compatible endpoint, keeping history in Anthropic message format. */
export async function runWorkersAiToolLoop(args: ToolLoopArgs): Promise<ToolLoopResult> {
  const messages = [...args.messages];
  let finalContent: ContentBlockParam[] = [];
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  for (let i = 0; i < args.maxIterations; i++) {
    const { choices, usage } = await callModel(args, messages);
    totalInputTokens += usage?.prompt_tokens ?? 0;
    totalOutputTokens += usage?.completion_tokens ?? 0;

    const reply = choices?.[0]?.message ?? {};
    const toolUses: ToolUseBlockParam[] = (reply.tool_calls ?? []).map((c, idx) => ({
      type: 'tool_use',
      id: c.id || `call_${i}_${idx}`,
      name: c.function?.name ?? '',
      input: parseArguments(c.function?.arguments),
    }));
    finalContent = [...(reply.content ? [{ type: 'text' as const, text: reply.content }] : []), ...toolUses];
    messages.push({ role: 'assistant', content: finalContent });

    if (!toolUses.length) break;
    const results: ToolResultBlockParam[] = [];
    for (const call of toolUses) results.push(await runTool(args.tools, call));
    messages.push({ role: 'user', content: results });
    if (toolUses.some((t) => t.name === args.stopAfterTool)) break;
  }

  return { messages, finalContent, totalInputTokens, totalOutputTokens, costUsd: 0 };
}
