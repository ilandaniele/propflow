import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoist mocks before module resolution ─────────────────────────────────────

const { mockMessagesCreate, mockAdminClient } = vi.hoisted(() => {
  const mockAdminClient = {
    storage: { from: vi.fn() },
    from: vi.fn(),
  };
  return { mockMessagesCreate: vi.fn(), mockAdminClient };
});

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn().mockReturnValue(mockAdminClient),
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

// ── Mock global fetch ─────────────────────────────────────────────────────────

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { handleTaskProof } from '@/lib/events/handlers/task-proof';
import type { TaskProofReceivedPayload } from '@/lib/events/types';

// ── Helpers ───────────────────────────────────────────────────────────────────

const BASE_PAYLOAD: TaskProofReceivedPayload = {
  orgId: 'org-1',
  taskId: 'task-1',
  proofId: 'proof-1',
  tenantId: 'tenant-1',
};

function makeFetchOkResponse() {
  const bytes = new Uint8Array([1, 2, 3]);
  return {
    ok: true,
    status: 200,
    arrayBuffer: vi.fn().mockResolvedValue(bytes.buffer),
    headers: { get: vi.fn().mockReturnValue('image/jpeg') },
  };
}

function makeClaudeResponse(text: string) {
  return {
    content: [{ type: 'text', text }],
  };
}

function makeChainableBuilder(finalResult: unknown = { data: null, error: null }) {
  const b: Record<string, unknown> = {};
  const chainMethods = ['select', 'eq', 'update', 'order', 'limit'];
  for (const m of chainMethods) {
    b[m] = vi.fn().mockReturnValue(b);
  }
  b.single = vi.fn().mockResolvedValue(finalResult);
  b.insert = vi.fn().mockResolvedValue(finalResult);
  return b;
}

function setupDefaultAdminClient() {
  const proofData = { id: 'proof-1', image_path: 'orgs/org-1/proofs/img.jpg' };
  const taskData = { id: 'task-1', task_type: 'maintenance', title: 'Fix roof' };

  mockAdminClient.storage.from = vi.fn().mockReturnValue({
    createSignedUrl: vi.fn().mockResolvedValue({
      data: { signedUrl: 'https://storage.example.com/proof.jpg' },
    }),
  });

  mockFetch.mockResolvedValue(makeFetchOkResponse());

  mockAdminClient.from = vi.fn().mockImplementation((table: string) => {
    if (table === 'task_proofs') {
      const b = makeChainableBuilder({ data: proofData, error: null });
      b.update = vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ data: null, error: null }),
      });
      return b;
    }
    if (table === 'tenant_tasks') {
      const b = makeChainableBuilder({ data: taskData, error: null });
      b.update = vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ data: null, error: null }),
      });
      return b;
    }
    if (table === 'profiles') {
      const b = makeChainableBuilder({ data: { id: 'admin-1' }, error: null });
      b.limit = vi.fn().mockReturnValue(b);
      b.single = vi.fn().mockResolvedValue({ data: { id: 'admin-1' }, error: null });
      return b;
    }
    if (table === 'notification_inbox') {
      return { insert: vi.fn().mockResolvedValue({ data: null, error: null }) };
    }
    return makeChainableBuilder({ data: null, error: null });
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  setupDefaultAdminClient();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('handleTaskProof', () => {
  // ── Missing data guard ─────────────────────────────────────────────────────

  it('returns early when proof row not found', async () => {
    mockAdminClient.from = vi.fn().mockImplementation((table: string) => {
      if (table === 'task_proofs') {
        return makeChainableBuilder({ data: null, error: null });
      }
      if (table === 'tenant_tasks') {
        return makeChainableBuilder({ data: { id: 'task-1', task_type: 'maintenance', title: 'Fix' }, error: null });
      }
      return makeChainableBuilder({ data: null, error: null });
    });

    await handleTaskProof(BASE_PAYLOAD);
    // Storage should not be called since proof was not found
    expect(mockAdminClient.storage.from).not.toHaveBeenCalled();
  });

  it('returns early when task row not found', async () => {
    mockAdminClient.from = vi.fn().mockImplementation((table: string) => {
      if (table === 'task_proofs') {
        return makeChainableBuilder({ data: { id: 'proof-1', image_path: 'img.jpg' }, error: null });
      }
      if (table === 'tenant_tasks') {
        return makeChainableBuilder({ data: null, error: null });
      }
      return makeChainableBuilder({ data: null, error: null });
    });

    await handleTaskProof(BASE_PAYLOAD);
    expect(mockAdminClient.storage.from).not.toHaveBeenCalled();
  });

  // ── Signed URL failure ─────────────────────────────────────────────────────

  it('marks proof as uncertain when signed URL cannot be obtained', async () => {
    mockAdminClient.storage.from = vi.fn().mockReturnValue({
      createSignedUrl: vi.fn().mockResolvedValue({ data: null }),
    });

    const updateTaskProofMock = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ data: null, error: null }),
    });

    mockAdminClient.from = vi.fn().mockImplementation((table: string) => {
      if (table === 'task_proofs') {
        const b = makeChainableBuilder({ data: { id: 'proof-1', image_path: 'img.jpg' }, error: null });
        b.update = updateTaskProofMock;
        return b;
      }
      if (table === 'tenant_tasks') {
        return makeChainableBuilder({ data: { id: 'task-1', task_type: 'maintenance', title: 'Fix' }, error: null });
      }
      return makeChainableBuilder({ data: null, error: null });
    });

    await handleTaskProof(BASE_PAYLOAD);
    expect(updateTaskProofMock).toHaveBeenCalledWith(
      expect.objectContaining({ ai_verdict: 'uncertain', admin_decision: null })
    );
  });

  // ── Image fetch failure ────────────────────────────────────────────────────

  it('marks proof as uncertain when image fetch fails', async () => {
    mockFetch.mockRejectedValue(new Error('Network error'));

    const updateTaskProofMock = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ data: null, error: null }),
    });
    const updateTaskMock = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ data: null, error: null }),
    });

    mockAdminClient.from = vi.fn().mockImplementation((table: string) => {
      if (table === 'task_proofs') {
        const b = makeChainableBuilder({ data: { id: 'proof-1', image_path: 'img.jpg' }, error: null });
        b.update = updateTaskProofMock;
        return b;
      }
      if (table === 'tenant_tasks') {
        const b = makeChainableBuilder({ data: { id: 'task-1', task_type: 'maintenance', title: 'Fix' }, error: null });
        b.update = updateTaskMock;
        return b;
      }
      return makeChainableBuilder({ data: null, error: null });
    });

    await handleTaskProof(BASE_PAYLOAD);
    expect(updateTaskProofMock).toHaveBeenCalledWith(
      expect.objectContaining({ ai_verdict: 'uncertain' })
    );
  });

  // ── AI verdict: accepted (valid + confidence >= 0.80) ─────────────────────

  it('marks task as completed when AI verdict is valid with confidence >= 0.80', async () => {
    mockMessagesCreate.mockResolvedValue(
      makeClaudeResponse('{"valid":true,"confidence":0.90,"reasoning":"Photo clearly shows completed task"}')
    );

    const updateTaskProofMock = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ data: null, error: null }),
    });
    const updateTaskMock = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ data: null, error: null }),
    });

    mockAdminClient.from = vi.fn().mockImplementation((table: string) => {
      if (table === 'task_proofs') {
        const b = makeChainableBuilder({ data: { id: 'proof-1', image_path: 'img.jpg' }, error: null });
        b.update = updateTaskProofMock;
        return b;
      }
      if (table === 'tenant_tasks') {
        const b = makeChainableBuilder({ data: { id: 'task-1', task_type: 'maintenance', title: 'Fix' }, error: null });
        b.update = updateTaskMock;
        return b;
      }
      return makeChainableBuilder({ data: null, error: null });
    });

    await handleTaskProof(BASE_PAYLOAD);

    // task_proofs updated with valid verdict + accepted decision
    expect(updateTaskProofMock).toHaveBeenCalledWith(
      expect.objectContaining({ ai_verdict: 'valid', admin_decision: 'accepted' })
    );
    // tenant_tasks updated to completed
    expect(updateTaskMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'completed' })
    );
  });

  // ── AI verdict: rejected (valid=false or confidence < 0.80) ───────────────

  it('routes to proof_pending_review when AI verdict is invalid', async () => {
    mockMessagesCreate.mockResolvedValue(
      makeClaudeResponse('{"valid":false,"confidence":0.85,"reasoning":"Photo does not show task completion"}')
    );

    const updateTaskProofMock = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ data: null, error: null }),
    });
    const updateTaskMock = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ data: null, error: null }),
    });

    mockAdminClient.from = vi.fn().mockImplementation((table: string) => {
      if (table === 'task_proofs') {
        const b = makeChainableBuilder({ data: { id: 'proof-1', image_path: 'img.jpg' }, error: null });
        b.update = updateTaskProofMock;
        return b;
      }
      if (table === 'tenant_tasks') {
        const b = makeChainableBuilder({ data: { id: 'task-1', task_type: 'maintenance', title: 'Fix' }, error: null });
        b.update = updateTaskMock;
        return b;
      }
      if (table === 'profiles') {
        const b = makeChainableBuilder({ data: { id: 'admin-1' }, error: null });
        b.limit = vi.fn().mockReturnValue(b);
        b.single = vi.fn().mockResolvedValue({ data: { id: 'admin-1' }, error: null });
        return b;
      }
      if (table === 'notification_inbox') {
        return { insert: vi.fn().mockResolvedValue({ data: null, error: null }) };
      }
      return makeChainableBuilder({ data: null, error: null });
    });

    await handleTaskProof(BASE_PAYLOAD);

    expect(updateTaskProofMock).toHaveBeenCalledWith(
      expect.objectContaining({ ai_verdict: 'invalid', admin_decision: null })
    );
    expect(updateTaskMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'proof_pending_review' })
    );
  });

  it('routes to proof_pending_review when valid=true but confidence < 0.80', async () => {
    mockMessagesCreate.mockResolvedValue(
      makeClaudeResponse('{"valid":true,"confidence":0.65,"reasoning":"Unclear photo"}')
    );

    const updateTaskProofMock = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ data: null, error: null }),
    });
    const updateTaskMock = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ data: null, error: null }),
    });

    mockAdminClient.from = vi.fn().mockImplementation((table: string) => {
      if (table === 'task_proofs') {
        const b = makeChainableBuilder({ data: { id: 'proof-1', image_path: 'img.jpg' }, error: null });
        b.update = updateTaskProofMock;
        return b;
      }
      if (table === 'tenant_tasks') {
        const b = makeChainableBuilder({ data: { id: 'task-1', task_type: 'maintenance', title: 'Fix' }, error: null });
        b.update = updateTaskMock;
        return b;
      }
      if (table === 'profiles') {
        const b = makeChainableBuilder({ data: null, error: null });
        b.limit = vi.fn().mockReturnValue(b);
        b.single = vi.fn().mockResolvedValue({ data: null, error: null });
        return b;
      }
      if (table === 'notification_inbox') {
        return { insert: vi.fn().mockResolvedValue({ data: null, error: null }) };
      }
      return makeChainableBuilder({ data: null, error: null });
    });

    await handleTaskProof(BASE_PAYLOAD);

    expect(updateTaskMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'proof_pending_review' })
    );
  });

  // ── JSON parse error ───────────────────────────────────────────────────────

  it('marks proof as uncertain when Claude returns non-JSON', async () => {
    mockMessagesCreate.mockResolvedValue(
      makeClaudeResponse('I cannot verify this photo.')
    );

    const updateTaskProofMock = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ data: null, error: null }),
    });

    mockAdminClient.from = vi.fn().mockImplementation((table: string) => {
      if (table === 'task_proofs') {
        const b = makeChainableBuilder({ data: { id: 'proof-1', image_path: 'img.jpg' }, error: null });
        b.update = updateTaskProofMock;
        return b;
      }
      if (table === 'tenant_tasks') {
        return makeChainableBuilder({ data: { id: 'task-1', task_type: 'maintenance', title: 'Fix' }, error: null });
      }
      return makeChainableBuilder({ data: null, error: null });
    });

    await handleTaskProof(BASE_PAYLOAD);
    expect(updateTaskProofMock).toHaveBeenCalledWith(
      expect.objectContaining({ ai_verdict: 'uncertain' })
    );
  });

  // ── Schema validation error ────────────────────────────────────────────────

  it('marks proof as uncertain when Claude returns invalid schema (missing fields)', async () => {
    mockMessagesCreate.mockResolvedValue(
      makeClaudeResponse('{"result":"yes"}')
    );

    const updateTaskProofMock = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ data: null, error: null }),
    });

    mockAdminClient.from = vi.fn().mockImplementation((table: string) => {
      if (table === 'task_proofs') {
        const b = makeChainableBuilder({ data: { id: 'proof-1', image_path: 'img.jpg' }, error: null });
        b.update = updateTaskProofMock;
        return b;
      }
      if (table === 'tenant_tasks') {
        return makeChainableBuilder({ data: { id: 'task-1', task_type: 'maintenance', title: 'Fix' }, error: null });
      }
      return makeChainableBuilder({ data: null, error: null });
    });

    await handleTaskProof(BASE_PAYLOAD);
    expect(updateTaskProofMock).toHaveBeenCalledWith(
      expect.objectContaining({ ai_verdict: 'uncertain' })
    );
  });

  // ── Claude SDK error ───────────────────────────────────────────────────────

  it('marks proof as uncertain and task as proof_pending_review when Claude SDK throws', async () => {
    mockMessagesCreate.mockRejectedValue(new Error('API rate limit'));

    const updateTaskProofMock = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ data: null, error: null }),
    });
    const updateTaskMock = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ data: null, error: null }),
    });

    mockAdminClient.from = vi.fn().mockImplementation((table: string) => {
      if (table === 'task_proofs') {
        const b = makeChainableBuilder({ data: { id: 'proof-1', image_path: 'img.jpg' }, error: null });
        b.update = updateTaskProofMock;
        return b;
      }
      if (table === 'tenant_tasks') {
        const b = makeChainableBuilder({ data: { id: 'task-1', task_type: 'maintenance', title: 'Fix' }, error: null });
        b.update = updateTaskMock;
        return b;
      }
      return makeChainableBuilder({ data: null, error: null });
    });

    await handleTaskProof(BASE_PAYLOAD);

    expect(updateTaskProofMock).toHaveBeenCalledWith(
      expect.objectContaining({ ai_verdict: 'uncertain' })
    );
    expect(updateTaskMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'proof_pending_review' })
    );
  });

  // ── Source matching ────────────────────────────────────────────────────────

  it('uses task_type and title in the Claude message content', async () => {
    mockMessagesCreate.mockResolvedValue(
      makeClaudeResponse('{"valid":true,"confidence":0.92,"reasoning":"OK"}')
    );

    const updateTaskProofMock = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ data: null, error: null }),
    });
    const updateTaskMock = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ data: null, error: null }),
    });

    mockAdminClient.from = vi.fn().mockImplementation((table: string) => {
      if (table === 'task_proofs') {
        const b = makeChainableBuilder({ data: { id: 'proof-1', image_path: 'img.jpg' }, error: null });
        b.update = updateTaskProofMock;
        return b;
      }
      if (table === 'tenant_tasks') {
        const b = makeChainableBuilder({
          data: { id: 'task-1', task_type: 'inspection', title: 'Monthly smoke detector check' },
          error: null,
        });
        b.update = updateTaskMock;
        return b;
      }
      return makeChainableBuilder({ data: null, error: null });
    });

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

    const updateTaskProofMock = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ data: null, error: null }),
    });
    const updateTaskMock = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ data: null, error: null }),
    });

    mockAdminClient.from = vi.fn().mockImplementation((table: string) => {
      if (table === 'task_proofs') {
        const b = makeChainableBuilder({ data: { id: 'proof-1', image_path: 'img.jpg' }, error: null });
        b.update = updateTaskProofMock;
        return b;
      }
      if (table === 'tenant_tasks') {
        const b = makeChainableBuilder({ data: { id: 'task-1', task_type: 'maintenance', title: 'Fix' }, error: null });
        b.update = updateTaskMock;
        return b;
      }
      return makeChainableBuilder({ data: null, error: null });
    });

    await handleTaskProof(BASE_PAYLOAD);
    // valid=true, confidence=0.85 >= 0.80 → should be accepted
    expect(updateTaskProofMock).toHaveBeenCalledWith(
      expect.objectContaining({ ai_verdict: 'valid', admin_decision: 'accepted' })
    );
  });
});
