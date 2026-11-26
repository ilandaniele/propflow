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

interface ChatToolCall {
  id?: string;
  function?: { name?: string; arguments?: unknown };
}

interface ChatResponse {
  choices?: { message?: { content?: string | null; tool_calls?: ChatToolCall[] } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

type ChatMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string; tool_calls?: unknown[] }
  | { role: 'tool'; tool_call_id: string; content: string };

export interface ToolLoopArgs {
  system: string;
  tools: LoopTool[];
  messages: MessageParam[];
  maxIterations: number;
  maxTokens: number;
}

export interface ToolLoopResult {
  messages: MessageParam[];
  finalContent: ContentBlockParam[];
  inputTokens: number;
  outputTokens: number;
}

const DEFAULT_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const TIMEOUT_MS = 30_000;

function blocksToText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((b): b is { type: 'text'; text: string } => b?.type === 'text')
    .map((b) => b.text)
    .join('\n');
}

function toChatMessages(m: MessageParam): ChatMessage[] {
  if (typeof m.content === 'string') return [{ role: m.role, content: m.content }];

  if (m.role === 'assistant') {
    const toolCalls = m.content
      .filter((b): b is ToolUseBlockParam => b.type === 'tool_use')
      .map((b) => ({ id: b.id, type: 'function', function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) } }));
    return [{ role: 'assistant', content: blocksToText(m.content), ...(toolCalls.length ? { tool_calls: toolCalls } : {}) }];
  }

  const results: ChatMessage[] = m.content
    .filter((b): b is ToolResultBlockParam => b.type === 'tool_result')
    .map((b) => ({ role: 'tool', tool_call_id: b.tool_use_id, content: blocksToText(b.content) }));
  const text = blocksToText(m.content);
  return text ? [...results, { role: 'user', content: text }] : results;
}

function parseArguments(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw ?? {};
  try {
    return raw.trim() ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

async function callModel(args: ToolLoopArgs, messages: MessageParam[]): Promise<ChatResponse> {
  const accountId = process.env.WORKERS_AI_ACCOUNT_ID;
  const token = process.env.WORKERS_AI_API_TOKEN;
  if (!accountId || !token) throw new Error('WORKERS_AI_ACCOUNT_ID / WORKERS_AI_API_TOKEN not set');

  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/ai/v1/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: process.env.AGENT_WORKERS_AI_MODEL || DEFAULT_MODEL,
      max_tokens: args.maxTokens,
      messages: [{ role: 'system', content: args.system }, ...messages.flatMap(toChatMessages)],
      tools: args.tools.map((t) => ({
        type: 'function',
        function: { name: t.name, description: t.description ?? '', parameters: t.input_schema ?? { type: 'object', properties: {} } },
      })),
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Workers AI HTTP ${res.status}`);
  return (await res.json()) as ChatResponse;
}

async function runTool(tools: LoopTool[], call: ToolUseBlockParam): Promise<ToolResultBlockParam> {
  const tool = tools.find((t) => t.name === call.name);
  if (!tool) return { type: 'tool_result', tool_use_id: call.id, content: `Error: unknown tool ${call.name}`, is_error: true };
  try {
    const context = { toolUse: call, toolUseBlock: call } as never;
    const output = await tool.run(tool.parse(call.input) as never, context);
    return { type: 'tool_result', tool_use_id: call.id, content: typeof output === 'string' ? output : JSON.stringify(output), is_error: false };
  } catch (e) {
    return { type: 'tool_result', tool_use_id: call.id, content: `Error: ${e instanceof Error ? e.message : String(e)}`, is_error: true };
  }
}

/** Tool-use loop over Workers AI's OpenAI-compatible endpoint, keeping history in Anthropic message format. */
export async function runWorkersAiToolLoop(args: ToolLoopArgs): Promise<ToolLoopResult> {
  const messages = [...args.messages];
  let finalContent: ContentBlockParam[] = [];
  let inputTokens = 0;
  let outputTokens = 0;

  for (let i = 0; i < args.maxIterations; i++) {
    const response = await callModel(args, messages);
    inputTokens += response.usage?.prompt_tokens ?? 0;
    outputTokens += response.usage?.completion_tokens ?? 0;

    const reply = response.choices?.[0]?.message ?? {};
    const toolUses: ToolUseBlockParam[] = (reply.tool_calls ?? []).map((c, idx) => ({
      type: 'tool_use',
      id: c.id || `call_${i}_${idx}`,
      name: c.function?.name ?? '',
      input: parseArguments(c.function?.arguments),
    }));
    finalContent = [...(reply.content ? [{ type: 'text' as const, text: reply.content }] : []), ...toolUses];
    messages.push({ role: 'assistant', content: finalContent });

    if (toolUses.length === 0) break;
    const results: ToolResultBlockParam[] = [];
    for (const call of toolUses) results.push(await runTool(args.tools, call));
    messages.push({ role: 'user', content: results });
  }

  return { messages, finalContent, inputTokens, outputTokens };
}
