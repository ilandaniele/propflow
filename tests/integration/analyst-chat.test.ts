/**
 * tests/integration/analyst-chat.test.ts
 *
 * AC16: Analyst free-form chat routes through /api/ai/chat.
 *
 * Verifies:
 * 1. POST /api/ai/chat with analyst session_id uses redactPiiFromUserMessage
 * 2. Combined context (system prompt + user message) is <= 8 KB
 * 3. No per-tenant PII appears in the system prompt or user message
 * 4. Unauthenticated request returns 401
 *
 * All Anthropic SDK and Supabase calls are mocked.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Track Anthropic calls
// ---------------------------------------------------------------------------

interface CapturedCall {
  system: string;
  userContent: string;
}
const capturedCalls: CapturedCall[] = [];

vi.mock('@anthropic-ai/sdk', () => {
  class MockAnthropic {
    messages = {
      stream: (_params: { system: string; messages: Array<{ role: string; content: string }> }) => {
        const userMsg = _params.messages.find((m) => m.role === 'user');
        capturedCalls.push({
          system: _params.system,
          userContent: userMsg?.content ?? '',
        });
        // Return a minimal async iterable (no actual streaming needed)
        return {
          [Symbol.asyncIterator]: async function* () {
            yield {
              type: 'content_block_delta',
              delta: { type: 'text_delta', text: 'Test response.' },
            };
          },
        };
      },
    };
  }
  return { default: MockAnthropic };
});

// ---------------------------------------------------------------------------
// Mock Supabase state
// ---------------------------------------------------------------------------

interface MockState {
  user: { id: string } | null;
  profile: { id: string; org_id: string; role: string; full_name: string; email: string; phone: string } | null;
}

const mockState: MockState = {
  user: { id: 'user-analyst-001' },
  profile: {
    id: 'user-analyst-001',
    org_id: 'org-analyst-001',
    role: 'admin',
    full_name: 'Analyst Admin',
    email: 'admin@analyst.test',
    phone: '+1-555-123-4567',
  },
};

// ---------------------------------------------------------------------------
// Mock: @/lib/db — covers ai/chat route (insert messages) + ai/budget
// ---------------------------------------------------------------------------

vi.mock('@/lib/db', () => {
  function getTableName(tableRef: unknown): string {
    if (!tableRef || typeof tableRef !== 'object') return '';
    const syms = Object.getOwnPropertySymbols(tableRef as object);
    const nameSym = syms.find(s => s.toString() === 'Symbol(drizzle:Name)');
    return nameSym ? String((tableRef as Record<symbol, unknown>)[nameSym]) : '';
  }

  return {
    db: {
      select: () => {
        let tableName = '';
        const chain = {
          from: vi.fn((tableRef: unknown) => {
            tableName = getTableName(tableRef);
            return chain;
          }),
          where: vi.fn().mockReturnThis(),
          orderBy: vi.fn().mockReturnThis(),
          limit: vi.fn(async () => {
            if (tableName === 'ai_token_budget') return [{ id: 'budget-row', tokensUsed: 0 }];
            if (tableName === 'units') return [{ id: 'u1', status: 'occupied' }];
            if (tableName === 'payments') return [{ amount: 1200 }];
            if (tableName === 'expenses') return [{ amount: 300 }];
            if (tableName === 'incidents') return [];
            return [];
          }),
          then: (resolve: (v: unknown[]) => void) => {
            if (tableName === 'units') resolve([{ id: 'u1', status: 'occupied' }]);
            else if (tableName === 'payments') resolve([{ amount: 1200 }]);
            else if (tableName === 'expenses') resolve([{ amount: 300 }]);
            else if (tableName === 'incidents') resolve([]);
            else if (tableName === 'ai_token_budget') resolve([{ id: 'budget-row', tokensUsed: 0 }]);
            else resolve([]);
          },
        };
        return chain;
      },
      insert: (tableRef: unknown) => {
        const table = getTableName(tableRef);
        void table;
        return {
          values: vi.fn(() => ({
            onConflictDoUpdate: vi.fn(async () => []),
            onConflictDoNothing: vi.fn(async () => []),
            returning: vi.fn(async () => [{ id: 'budget-row', tokensUsed: 0 }]),
          })),
        };
      },
      update: () => ({
        set: vi.fn(() => ({
          where: vi.fn(async () => []),
        })),
      }),
      execute: vi.fn(async () => [{ is_overdue: false, tenant_id: 't1' }]),
    },
  };
});

// Mock profiles read inside getProfile
// Mock @/auth to avoid DrizzleAdapter initialization failure
vi.mock('@/auth', () => ({
  auth: vi.fn(async () => null),
  handlers: { GET: vi.fn(), POST: vi.fn() },
  signIn: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock('@/lib/auth/guards', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/guards')>();
  return {
    ...actual,
    getCachedUser: vi.fn(async () => mockState.user),
    getProfile: vi.fn(async () => mockState.profile),
    requireUser: vi.fn(async () => ({
      userId: mockState.user!.id,
      orgId: mockState.profile!.org_id,
      role: mockState.profile!.role,
      profile: mockState.profile,
    })),
  };
});

// ---------------------------------------------------------------------------
// Import after mocks are set up
// ---------------------------------------------------------------------------

const { POST } = await import('@/app/api/ai/chat/route');

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AC16: /api/ai/chat context bounds and PII exclusion', () => {
  beforeEach(() => {
    capturedCalls.length = 0;
    process.env['ANTHROPIC_API_KEY'] = 'test-key-analyst';
  });

  it('unauthenticated request returns 401', async () => {
    const savedUser = mockState.user;
    mockState.user = null;
    const req = new Request('http://localhost/api/ai/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: crypto.randomUUID(), message: 'Hello' }),
    });
    const response = await POST(req as never);
    expect(response.status).toBe(401);
    mockState.user = savedUser;
  });

  it('system prompt + user message combined is <= 8 KB', async () => {
    const req = new Request('http://localhost/api/ai/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_id: crypto.randomUUID(),
        message: 'What is my occupancy rate?',
      }),
    });
    const response = await POST(req as never);
    // Response may be SSE stream — just check it's not a 4xx/5xx error
    expect(response.status).not.toBe(400);
    expect(response.status).not.toBe(500);

    // Check the captured prompt
    expect(capturedCalls.length).toBeGreaterThanOrEqual(1);
    const { system, userContent } = capturedCalls[0];

    const combinedBytes =
      Buffer.byteLength(system, 'utf8') + Buffer.byteLength(userContent, 'utf8');
    expect(combinedBytes).toBeLessThanOrEqual(8 * 1024);
  });

  it('system prompt does not contain per-tenant PII (email, full_name, phone)', async () => {
    const req = new Request('http://localhost/api/ai/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_id: crypto.randomUUID(),
        message: 'Tell me about tenant balances.',
      }),
    });
    await POST(req as never);

    expect(capturedCalls.length).toBeGreaterThanOrEqual(1);
    const { system } = capturedCalls[0];

    // The system prompt must not include tenant email, full_name, or phone
    expect(system).not.toContain('admin@analyst.test');
    expect(system).not.toContain('Analyst Admin');
    expect(system).not.toContain('+1-555-123-4567');
  });

  it('user message with PII is redacted before LLM call', async () => {
    const req = new Request('http://localhost/api/ai/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_id: crypto.randomUUID(),
        message: 'Check tenant john@example.com with phone 555-234-5678',
      }),
    });
    await POST(req as never);

    expect(capturedCalls.length).toBeGreaterThanOrEqual(1);
    const { userContent } = capturedCalls[0];

    // Email and phone should be redacted
    expect(userContent).not.toContain('john@example.com');
    expect(userContent).not.toContain('555-234-5678');
    expect(userContent).toContain('[EMAIL]');
    expect(userContent).toContain('[PHONE]');
  });

  it('uses sanitizeForLLM-safe aggregate context — no raw DB rows in prompt', async () => {
    const req = new Request('http://localhost/api/ai/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_id: crypto.randomUUID(),
        message: '¿Cuál es mi ocupación?',
      }),
    });
    await POST(req as never);

    expect(capturedCalls.length).toBeGreaterThanOrEqual(1);
    const { system } = capturedCalls[0];

    // System prompt should contain aggregate numbers, not raw objects
    // It should mention occupancy (100% since 1 occupied of 1 unit in mock)
    expect(system).toMatch(/\d+/); // at least some numbers
    // Should NOT contain raw JSON arrays of tenant rows
    expect(system).not.toMatch(/\[\s*\{.*email.*\}/s);
  });
});
