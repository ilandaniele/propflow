import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Mock @anthropic-ai/sdk ───────────────────────────────────────────────────

const { mockMessagesCreate } = vi.hoisted(() => ({
  mockMessagesCreate: vi.fn(),
}));

vi.mock('@anthropic-ai/sdk', () => {
  function AnthropicMock() {
    return { messages: { create: mockMessagesCreate } };
  }
  return { default: AnthropicMock };
});

// ── Mock @/lib/env ────────────────────────────────────────────────────────────

vi.mock('@/lib/env', () => ({
  assertServerEnv: vi.fn().mockReturnValue('test-anthropic-key'),
}));

import { runOcr } from '@/lib/ocr/run-ocr';

function makeClaudeResponse(text: string) {
  return {
    content: [{ type: 'text', text }],
  };
}

const VALID_INPUT = {
  imageBase64: Buffer.from('fake-image').toString('base64'),
  mimeType: 'image/jpeg' as const,
  contextTag: 'test-ocr',
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('runOcr', () => {
  // ── Successful extraction ──────────────────────────────────────────────────

  it('returns success=true with parsed data when Claude returns valid JSON', async () => {
    mockMessagesCreate.mockResolvedValue(
      makeClaudeResponse('{"amount":500.00,"date":"2026-05-15","vendor":"Home Depot","confidence":0.94}')
    );

    const result = await runOcr(VALID_INPUT);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.amount).toBe(500);
      expect(result.data.date).toBe('2026-05-15');
      expect(result.data.vendor).toBe('Home Depot');
      expect(result.data.confidence).toBeCloseTo(0.94);
    }
  });

  it('strips markdown code fences from Claude response', async () => {
    mockMessagesCreate.mockResolvedValue(
      makeClaudeResponse('```json\n{"amount":250,"date":"2026-01-20","vendor":"Banco","confidence":0.88}\n```')
    );

    const result = await runOcr(VALID_INPUT);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.amount).toBe(250);
    }
  });

  it('returns success=true with null fields when Claude cannot determine values', async () => {
    mockMessagesCreate.mockResolvedValue(
      makeClaudeResponse('{"amount":null,"date":null,"vendor":null,"confidence":null}')
    );

    const result = await runOcr(VALID_INPUT);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.amount).toBeNull();
      expect(result.data.confidence).toBeNull();
    }
  });

  // ── Malformed JSON ────────────────────────────────────────────────────────

  it('returns success=false when Claude returns non-JSON text', async () => {
    mockMessagesCreate.mockResolvedValue(
      makeClaudeResponse('I cannot read this receipt.')
    );

    const result = await runOcr(VALID_INPUT);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('JSON');
    }
  });

  it('returns success=false for partially valid JSON (truncated)', async () => {
    mockMessagesCreate.mockResolvedValue(
      makeClaudeResponse('{"amount":100,"date":')
    );

    const result = await runOcr(VALID_INPUT);
    expect(result.success).toBe(false);
  });

  // ── Schema validation failure ─────────────────────────────────────────────

  it('returns success=false when confidence > 1 (schema rejects it)', async () => {
    mockMessagesCreate.mockResolvedValue(
      makeClaudeResponse('{"amount":100,"date":"2026-01-01","vendor":"Shop","confidence":1.5}')
    );

    const result = await runOcr(VALID_INPUT);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('Schema');
    }
  });

  it('returns success=false when amount is negative (schema rejects it)', async () => {
    mockMessagesCreate.mockResolvedValue(
      makeClaudeResponse('{"amount":-50,"date":"2026-01-01","vendor":"Shop","confidence":0.9}')
    );

    const result = await runOcr(VALID_INPUT);
    expect(result.success).toBe(false);
  });

  it('returns success=false when date format is wrong', async () => {
    mockMessagesCreate.mockResolvedValue(
      makeClaudeResponse('{"amount":100,"date":"15/05/2026","vendor":"Shop","confidence":0.9}')
    );

    const result = await runOcr(VALID_INPUT);
    expect(result.success).toBe(false);
  });

  // ── Missing fields ────────────────────────────────────────────────────────

  it('returns success=true with missing fields (schema allows omission)', async () => {
    mockMessagesCreate.mockResolvedValue(makeClaudeResponse('{}'));

    const result = await runOcr(VALID_INPUT);
    expect(result.success).toBe(true);
  });

  // ── SDK error ─────────────────────────────────────────────────────────────

  it('returns success=false when Claude SDK throws', async () => {
    mockMessagesCreate.mockRejectedValue(new Error('connection refused'));

    const result = await runOcr(VALID_INPUT);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe('OCR extraction failed');
    }
  });

  it('returns success=false when AbortController aborts (timeout)', async () => {
    const abortError = new DOMException('The operation was aborted', 'AbortError');
    mockMessagesCreate.mockRejectedValue(abortError);

    const result = await runOcr(VALID_INPUT);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe('OCR extraction failed');
    }
  });

  // ── Content edge cases ────────────────────────────────────────────────────

  it('uses {} fallback when Claude response content array is empty', async () => {
    mockMessagesCreate.mockResolvedValue({ content: [] });

    const result = await runOcr(VALID_INPUT);
    // {} parses but schema validation passes (all fields optional)
    expect(result.success).toBe(true);
  });

  it('accepts different mime types', async () => {
    mockMessagesCreate.mockResolvedValue(
      makeClaudeResponse('{"amount":100,"confidence":0.9}')
    );

    for (const mimeType of ['image/png', 'image/webp', 'image/gif'] as const) {
      const result = await runOcr({ ...VALID_INPUT, mimeType });
      expect(result.success).toBe(true);
    }
  });

  it('uses contextTag in log calls (does not throw)', async () => {
    mockMessagesCreate.mockRejectedValue(new Error('api error'));

    // Should not throw, just return error result
    const result = await runOcr({ ...VALID_INPUT, contextTag: 'wa-receipt' });
    expect(result.success).toBe(false);
  });
});
