import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoist mocks before module resolution ─────────────────────────────────────

const { mockMessagesCreate, mockGetSignedUrl, mockFetch } = vi.hoisted(() => ({
  mockMessagesCreate: vi.fn(),
  mockGetSignedUrl:   vi.fn(),
  mockFetch:          vi.fn(),
}));

// ── Mock @/lib/storage ────────────────────────────────────────────────────────
vi.mock('@/lib/storage', () => ({
  getSignedUrl: mockGetSignedUrl,
  uploadFile:   vi.fn(),
  deleteImage:  vi.fn(),
}));

// ── Mock @anthropic-ai/sdk ────────────────────────────────────────────────────

vi.mock('@anthropic-ai/sdk', () => {
  function AnthropicMock() {
    return { messages: { create: mockMessagesCreate } };
  }
  return { default: AnthropicMock };
});

// ── Mock @/lib/env ────────────────────────────────────────────────────────────
vi.mock('@/lib/env', () => ({
  assertServerEnv: vi.fn().mockReturnValue('test-api-key'),
}));

// ── Mock @/lib/db — Drizzle ───────────────────────────────────────────────────

// Per-table select results
const selectResults: Record<string, unknown[]> = {};
// Capture update calls: updateCalls[table] = [{ set, where }]
const updateCalls: Record<string, Array<Record<string, unknown>>> = {};
// Capture insert calls
const insertCalls: Array<{ table: string; values: unknown }> = [];

vi.mock('@/lib/db', () => {
  function getTableName(tableRef: unknown): string {
    if (!tableRef || typeof tableRef !== 'object') return 'unknown';
    const syms = Object.getOwnPropertySymbols(tableRef as object);
    const nameSym = syms.find((s) => s.toString() === 'Symbol(drizzle:Name)');
    return nameSym ? String((tableRef as Record<symbol, unknown>)[nameSym]) : 'unknown';
  }

  return {
    db: {
      select: vi.fn(() => {
        let tableName = 'unknown';
        const chain = {
          from: vi.fn((tableRef: unknown) => {
            tableName = getTableName(tableRef);
            return chain;
          }),
          where: vi.fn().mockReturnThis(),
          limit: vi.fn(async () => selectResults[tableName] ?? []),
        };
        return chain;
      }),

      update: (tableRef: unknown) => {
        const tableName = getTableName(tableRef);
        return {
          set: vi.fn((vals: Record<string, unknown>) => {
            updateCalls[tableName] = updateCalls[tableName] ?? [];
            updateCalls[tableName].push(vals);
            return {
              where: vi.fn(async () => []),
            };
          }),
        };
      },

      insert: (tableRef: unknown) => {
        const tableName = getTableName(tableRef);
        return {
          values: vi.fn((vals: unknown) => {
            insertCalls.push({ table: tableName, values: vals });
            return Promise.resolve([]);
          }),
        };
      },
    },
  };
});

vi.stubGlobal('fetch', mockFetch);

import { handleTaskProof } from '@/lib/events/handlers/task-proof';
import type { TaskProofReceivedPayload } from '@/lib/events/types';

// ── Helpers ───────────────────────────────────────────────────────────────────

const BASE_PAYLOAD: TaskProofReceivedPayload = {
  orgId:  'org-1',
  taskId: 'task-1',
  proofId: 'proof-1',
  tenantId: 'tenant-1',
};

function makeFetchOkResponse() {
  const bytes = new Uint8Array([1, 2, 3]);
  return {
    ok:          true,
    status:      200,
    arrayBuffer: vi.fn().mockResolvedValue(bytes.buffer),
    headers:     { get: vi.fn().mockReturnValue('image/jpeg') },
  };
}

function makeClaudeResponse(text: string) {
  return { content: [{ type: 'text', text }] };
}

function setupDefaultData(opts: { proof?: unknown; task?: unknown } = {}) {
  selectResults['task_proofs']  = opts.proof ? [opts.proof] : [{ id: 'proof-1', imagePath: 'orgs/org-1/proofs/img.jpg' }];
  selectResults['tenant_tasks'] = opts.task  ? [opts.task]  : [{ id: 'task-1', taskType: 'maintenance', title: 'Fix roof' }];
  selectResults['profiles']     = [{ id: 'admin-1' }];
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of Object.keys(selectResults))  delete selectResults[k];
  for (const k of Object.keys(updateCalls))    delete updateCalls[k];
  insertCalls.length = 0;

  mockGetSignedUrl.mockResolvedValue('https://storage.example.com/proof.jpg');
  mockFetch.mockResolvedValue(makeFetchOkResponse());
  mockMessagesCreate.mockResolvedValue(makeClaudeResponse('{"valid":true,"confidence":0.90,"reasoning":"OK"}'));

  setupDefaultData();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('handleTaskProof', () => {
  // ── Missing data guard ─────────────────────────────────────────────────────

  it('returns early when proof row not found', async () => {
    selectResults['task_proofs'] = [];  // no proof

    await handleTaskProof(BASE_PAYLOAD);
    expect(mockGetSignedUrl).not.toHaveBeenCalled();
  });

  it('returns early when task row not found', async () => {
    selectResults['tenant_tasks'] = [];  // no task

    await handleTaskProof(BASE_PAYLOAD);
    expect(mockGetSignedUrl).not.toHaveBeenCalled();
  });

  // ── Signed URL failure ─────────────────────────────────────────────────────

  it('marks proof as uncertain when signed URL cannot be obtained', async () => {
    mockGetSignedUrl.mockRejectedValue(new Error('Storage error'));

    await handleTaskProof(BASE_PAYLOAD);

    const proofUpdates = updateCalls['task_proofs'] ?? [];
    expect(proofUpdates.some(u => u['aiVerdict'] === 'uncertain')).toBe(true);
  });

  // ── Image fetch failure ────────────────────────────────────────────────────

  it('marks proof as uncertain when image fetch fails', async () => {
    mockFetch.mockRejectedValue(new Error('Network error'));

    await handleTaskProof(BASE_PAYLOAD);

    const proofUpdates = updateCalls['task_proofs'] ?? [];
    expect(proofUpdates.some(u => u['aiVerdict'] === 'uncertain')).toBe(true);
  });

  // ── AI verdict: accepted (valid + confidence >= 0.80) ─────────────────────

  it('marks task as completed when AI verdict is valid with confidence >= 0.80', async () => {
    mockMessagesCreate.mockResolvedValue(
      makeClaudeResponse('{"valid":true,"confidence":0.90,"reasoning":"Photo clearly shows completed task"}')
    );

    await handleTaskProof(BASE_PAYLOAD);

    const proofUpdates = updateCalls['task_proofs'] ?? [];
    expect(proofUpdates.some(u => u['aiVerdict'] === 'valid' && u['adminDecision'] === 'accepted')).toBe(true);

    const taskUpdates = updateCalls['tenant_tasks'] ?? [];
    expect(taskUpdates.some(u => u['status'] === 'completed')).toBe(true);
  });

  // ── AI verdict: rejected ───────────────────────────────────────────────────

  it('routes to proof_pending_review when AI verdict is invalid', async () => {
    mockMessagesCreate.mockResolvedValue(
      makeClaudeResponse('{"valid":false,"confidence":0.85,"reasoning":"Photo does not show task completion"}')
    );

    await handleTaskProof(BASE_PAYLOAD);

    const proofUpdates = updateCalls['task_proofs'] ?? [];
    expect(proofUpdates.some(u => u['aiVerdict'] === 'invalid' && u['adminDecision'] === null)).toBe(true);

    const taskUpdates = updateCalls['tenant_tasks'] ?? [];
    expect(taskUpdates.some(u => u['status'] === 'proof_pending_review')).toBe(true);
  });

  it('routes to proof_pending_review when valid=true but confidence < 0.80', async () => {
    mockMessagesCreate.mockResolvedValue(
      makeClaudeResponse('{"valid":true,"confidence":0.65,"reasoning":"Unclear photo"}')
    );

    await handleTaskProof(BASE_PAYLOAD);

    const taskUpdates = updateCalls['tenant_tasks'] ?? [];
    expect(taskUpdates.some(u => u['status'] === 'proof_pending_review')).toBe(true);
  });

  // ── JSON parse error ───────────────────────────────────────────────────────

  it('marks proof as uncertain when Claude returns non-JSON', async () => {
    mockMessagesCreate.mockResolvedValue(
      makeClaudeResponse('I cannot verify this photo.')
    );

    await handleTaskProof(BASE_PAYLOAD);

    const proofUpdates = updateCalls['task_proofs'] ?? [];
    expect(proofUpdates.some(u => u['aiVerdict'] === 'uncertain')).toBe(true);
  });

  // ── Schema validation error ────────────────────────────────────────────────

  it('marks proof as uncertain when Claude returns invalid schema (missing fields)', async () => {
    mockMessagesCreate.mockResolvedValue(
      makeClaudeResponse('{"result":"yes"}')
    );

    await handleTaskProof(BASE_PAYLOAD);

    const proofUpdates = updateCalls['task_proofs'] ?? [];
    expect(proofUpdates.some(u => u['aiVerdict'] === 'uncertain')).toBe(true);
  });

  // ── Claude SDK error ───────────────────────────────────────────────────────

  it('marks proof as uncertain and task as proof_pending_review when Claude SDK throws', async () => {
    mockMessagesCreate.mockRejectedValue(new Error('API rate limit'));

    await handleTaskProof(BASE_PAYLOAD);

    const proofUpdates = updateCalls['task_proofs'] ?? [];
    expect(proofUpdates.some(u => u['aiVerdict'] === 'uncertain')).toBe(true);

    const taskUpdates = updateCalls['tenant_tasks'] ?? [];
    expect(taskUpdates.some(u => u['status'] === 'proof_pending_review')).toBe(true);
  });

  // ── Source matching ────────────────────────────────────────────────────────

  it('uses task_type and title in the Claude message content', async () => {
    selectResults['tenant_tasks'] = [{ id: 'task-1', taskType: 'inspection', title: 'Monthly smoke detector check' }];
    mockMessagesCreate.mockResolvedValue(
      makeClaudeResponse('{"valid":true,"confidence":0.92,"reasoning":"OK"}')
    );

    await handleTaskProof(BASE_PAYLOAD);

    const callArgs = mockMessagesCreate.mock.calls[0][0];
    const userTextContent = callArgs.messages[0].content.find(
      (c: { type: string }) => c.type === 'text'
    );
    expect(userTextContent?.text).toContain('inspection');
    expect(userTextContent?.text).toContain('Monthly smoke detector check');
  });

  it('strips markdown fences from Claude response before parsing', async () => {
    mockMessagesCreate.mockResolvedValue(
      makeClaudeResponse('```json\n{"valid":true,"confidence":0.85,"reasoning":"Done"}\n```')
    );

    await handleTaskProof(BASE_PAYLOAD);

    // valid=true, confidence=0.85 >= 0.80 → should be accepted
    const proofUpdates = updateCalls['task_proofs'] ?? [];
    expect(proofUpdates.some(u => u['aiVerdict'] === 'valid' && u['adminDecision'] === 'accepted')).toBe(true);
  });
});
