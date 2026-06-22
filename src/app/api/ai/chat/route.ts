export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { db } from '@/lib/db';
import { aiChatMessages } from '@/lib/db/schema';
import { requireUser } from '@/lib/auth/guards';
import { Errors } from '@/lib/errors';
import { aiChatRateLimit } from '@/lib/ratelimit';
import { assertServerEnv } from '@/lib/env';
import { AiChatSchema } from '@/lib/schemas/ai';
import { buildOrgContext, buildSystemPrompt, redactPiiFromUserMessage } from '@/lib/ai/assistant';
import { checkAndIncrementBudget, DAILY_TOKEN_BUDGET } from '@/lib/ai/budget';
import { log } from '@/lib/log';

const AI_MODEL = 'claude-opus-4-5';
const MAX_TOKENS = 1024;
/**
 * AC16: total context (system prompt + user message) is bounded to <= 8 KB.
 * buildOrgContext produces ~600-900 bytes; user message is capped at 4000 chars
 * via AiChatSchema. The guard below truncates if somehow the combined payload
 * exceeds the limit (defence-in-depth).
 */
const MAX_CONTEXT_BYTES = 8 * 1024; // 8 KB

export async function POST(request: NextRequest): Promise<NextResponse> {
  // Auth guard
  let ctx;
  try { ctx = await requireUser(); } catch {
    return NextResponse.json(Errors.UNAUTHORIZED(), { status: 401 });
  }

  // Rate limit: 20/day/user + 5/min/user + 500/day/org (fail-closed — LLM10)
  const rl = aiChatRateLimit(ctx.userId, ctx.orgId);
  if (!rl.success) {
    return NextResponse.json(Errors.RATE_LIMITED(), { status: 429 });
  }

  // LLM10: per-org daily token budget check (AC30 / spec §LLM Security)
  // Conservative estimate per chat turn: 500 tokens.
  const TOKENS_PER_CHAT_TURN = 500;
  const budgetCheck = await checkAndIncrementBudget(ctx.orgId, TOKENS_PER_CHAT_TURN);
  if (!budgetCheck.allowed) {
    log.warn('[ai/chat] daily token budget exceeded', { orgId: ctx.orgId });
    return NextResponse.json(
      { error: { code: 'AI_BUDGET_EXCEEDED', message: `Daily AI token budget (${DAILY_TOKEN_BUDGET} tokens) exceeded. Try again tomorrow.` } },
      { status: 429, headers: { 'Retry-After': '86400' } },
    );
  }

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json(Errors.VALIDATION_ERROR({ formErrors: ['Invalid JSON'], fieldErrors: {} }), { status: 400 });
  }

  const parsed = AiChatSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(Errors.VALIDATION_ERROR(parsed.error.flatten()), { status: 400 });
  }

  try {
    // Build org-scoped context (aggregates only — LLM06)
    const orgCtx = await buildOrgContext(ctx.orgId);
    const systemPrompt = buildSystemPrompt(orgCtx);

    // LLM01: user input as structured user turn, never concatenated into system prompt
    // LLM06: redact PII patterns from user message
    const cleanedMessage = redactPiiFromUserMessage(parsed.data.message);

    // AC16: enforce combined context bound <= 8 KB (system + user message).
    const combinedBytes =
      Buffer.byteLength(systemPrompt, 'utf8') + Buffer.byteLength(cleanedMessage, 'utf8');
    let effectiveSystemPrompt = systemPrompt;
    if (combinedBytes > MAX_CONTEXT_BYTES) {
      const maxSystemBytes =
        MAX_CONTEXT_BYTES - Buffer.byteLength(cleanedMessage, 'utf8') - 64; // 64-byte safety margin
      effectiveSystemPrompt = Buffer.from(systemPrompt, 'utf8')
        .subarray(0, maxSystemBytes)
        .toString('utf8');
      log.info('[ai/chat] context truncated to 8 KB', { originalBytes: combinedBytes });
    }

    // Persist user message — Drizzle (AC1, AC8: orgId scoped)
    await db.insert(aiChatMessages).values({
      orgId: ctx.orgId,
      profileId: ctx.userId,
      sessionId: parsed.data.session_id,
      role: 'user',
      content: parsed.data.message, // store original (not redacted) for UX
    });

    const apiKey = assertServerEnv('ANTHROPIC_API_KEY', 'AI assistant');
    const anthropic = new Anthropic({ apiKey });

    // Stream the response (SSE — server-side only; browser talks to same-origin)
    const stream = await anthropic.messages.stream({
      model: AI_MODEL,
      max_tokens: MAX_TOKENS,
      system: effectiveSystemPrompt,
      messages: [{ role: 'user', content: cleanedMessage }],
    });

    let fullResponse = '';
    const encoder = new TextEncoder();

    const readable = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of stream) {
            if (
              chunk.type === 'content_block_delta' &&
              chunk.delta.type === 'text_delta'
            ) {
              const text = chunk.delta.text;
              fullResponse += text;
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text })}\n\n`));
            }
          }

          // Persist assistant message after stream completes — Drizzle (AC1, AC8)
          await db.insert(aiChatMessages).values({
            orgId: ctx.orgId,
            profileId: ctx.userId,
            sessionId: parsed.data.session_id,
            role: 'assistant',
            content: fullResponse,
          });

          log.info('[ai/chat] response streamed', { sessionId: parsed.data.session_id, length: fullResponse.length });
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
        } catch (e) {
          // A10: fail-closed
          const msg = e instanceof Error ? e.message : 'unknown';
          log.error('[ai/chat] stream error', { error: msg });
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: 'Stream failed' })}\n\n`));
          controller.close();
        }
      },
    });

    return new NextResponse(readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });

  } catch (e) {
    // A10: fail-closed; generic error, no stack trace
    const msg = e instanceof Error ? e.message : 'unknown';
    log.error('[ai/chat] exception', { error: msg });
    return NextResponse.json(Errors.INTERNAL(), { status: 500 });
  }
}
