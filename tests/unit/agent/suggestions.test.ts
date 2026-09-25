import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  txUpdateSets, txInsertedValues, updateCalls, updateQueue,
  recordAgentEventMock, setAssistantMessageSendStatusMock, sendWhatsAppTextMock,
} = vi.hoisted(() => ({
  txUpdateSets: [] as Record<string, unknown>[],
  txInsertedValues: [] as Record<string, unknown>[],
  updateCalls: [] as Record<string, unknown>[],
  updateQueue: [] as unknown[][], // one array of returned rows per db.update(...).returning() call, consumed in order
  recordAgentEventMock: vi.fn(),
  setAssistantMessageSendStatusMock: vi.fn(),
  sendWhatsAppTextMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: {
    transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        update: vi.fn(() => ({
          set: vi.fn((s: Record<string, unknown>) => {
            txUpdateSets.push(s);
            return { where: vi.fn(async () => undefined) };
          }),
        })),
        insert: vi.fn(() => ({
          values: vi.fn((v: Record<string, unknown>) => {
            txInsertedValues.push(v);
            return { returning: vi.fn(async () => [{ id: 'suggestion-new' }]) };
          }),
        })),
      };
      return fn(tx);
    }),
    update: vi.fn(() => ({
      set: vi.fn((s: Record<string, unknown>) => {
        updateCalls.push(s);
        return { where: vi.fn(() => ({ returning: vi.fn(async () => updateQueue.shift() ?? []) })) };
      }),
    })),
  },
}));

vi.mock('@/lib/agent/events', () => ({ recordAgentEvent: recordAgentEventMock }));
vi.mock('@/lib/agent/session', () => ({ setAssistantMessageSendStatus: setAssistantMessageSendStatusMock }));
vi.mock('@/lib/agent/outbound', () => ({ sendWhatsAppText: sendWhatsAppTextMock }));

import { createSuggestion, approveSuggestion, discardSuggestion } from '@/lib/agent/suggestions';

function pendingSuggestionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'suggestion-1',
    orgId: 'org-1',
    sessionId: 'session-1',
    whatsappConversationId: 'conv-1',
    agentMessageId: 'msg-1',
    body: 'Hola, tenemos disponible...',
    status: 'sent',
    ...overrides,
  };
}

describe('agent/suggestions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    txUpdateSets.length = 0;
    txInsertedValues.length = 0;
    updateCalls.length = 0;
    updateQueue.length = 0;
  });

  describe('createSuggestion', () => {
    it('supersedes any existing pending suggestion before inserting the new one', async () => {
      const id = await createSuggestion({ orgId: 'org-1', sessionId: 'session-1', conversationId: 'conv-1', body: 'hola' });

      expect(id).toBe('suggestion-new');
      expect(txUpdateSets[0]).toMatchObject({ status: 'superseded' });
      expect(txInsertedValues[0]).toMatchObject({ body: 'hola', orgId: 'org-1', sessionId: 'session-1' });
    });

    it('stores agentMessageId when provided (Override: links to the agent_messages draft row)', async () => {
      await createSuggestion({ orgId: 'org-1', sessionId: 'session-1', conversationId: 'conv-1', body: 'hola', agentMessageId: 'msg-42' });
      expect(txInsertedValues[0]).toMatchObject({ agentMessageId: 'msg-42' });
    });
  });

  describe('approveSuggestion', () => {
    it('approving twice sends once — the second call finds no pending row', async () => {
      updateQueue.push([pendingSuggestionRow()]); // 1st call claims it
      updateQueue.push([]); // sentMessageId update (ignored by test)
      sendWhatsAppTextMock.mockResolvedValue({ ok: true, messageId: 'wa-msg-1' });

      const first = await approveSuggestion({ orgId: 'org-1', suggestionId: 'suggestion-1', profileId: 'profile-1' });
      expect(first.ok).toBe(true);
      expect(sendWhatsAppTextMock).toHaveBeenCalledOnce();

      updateQueue.push([]); // 2nd call: WHERE status='pending' matches nothing now
      const second = await approveSuggestion({ orgId: 'org-1', suggestionId: 'suggestion-1', profileId: 'profile-1' });

      expect(second).toEqual({ ok: false, code: 'NOT_FOUND' });
      expect(sendWhatsAppTextMock).toHaveBeenCalledOnce(); // still just once
    });

    it('sends the original body when not edited, and flips the agent_messages row to sent with no edited text', async () => {
      updateQueue.push([pendingSuggestionRow({ body: 'Texto original' })]);
      updateQueue.push([]);
      sendWhatsAppTextMock.mockResolvedValue({ ok: true, messageId: 'wa-msg-2' });

      await approveSuggestion({ orgId: 'org-1', suggestionId: 'suggestion-1', profileId: 'profile-1' });

      expect(sendWhatsAppTextMock).toHaveBeenCalledWith(expect.objectContaining({ body: 'Texto original', senderKind: 'human' }));
      expect(setAssistantMessageSendStatusMock).toHaveBeenCalledWith('msg-1', 'sent', undefined);
    });

    it('sends the edited body when provided, and the edited text is what gets marked sent', async () => {
      updateQueue.push([pendingSuggestionRow({ body: 'Texto original' })]);
      updateQueue.push([]);
      sendWhatsAppTextMock.mockResolvedValue({ ok: true, messageId: 'wa-msg-3' });

      await approveSuggestion({ orgId: 'org-1', suggestionId: 'suggestion-1', profileId: 'profile-1', editedBody: 'Texto editado' });

      expect(sendWhatsAppTextMock).toHaveBeenCalledWith(expect.objectContaining({ body: 'Texto editado' }));
      expect(setAssistantMessageSendStatusMock).toHaveBeenCalledWith('msg-1', 'sent', 'Texto editado');
    });

    it('records a suggestion_sent event', async () => {
      updateQueue.push([pendingSuggestionRow()]);
      updateQueue.push([]);
      sendWhatsAppTextMock.mockResolvedValue({ ok: true, messageId: 'wa-msg-4' });

      await approveSuggestion({ orgId: 'org-1', suggestionId: 'suggestion-1', profileId: 'profile-1' });

      expect(recordAgentEventMock).toHaveBeenCalledWith(expect.objectContaining({ kind: 'suggestion_sent', actorProfileId: 'profile-1' }));
    });
  });

  describe('discardSuggestion', () => {
    it('discards a pending suggestion, marks the draft shadow_discarded, and records an event', async () => {
      updateQueue.push([pendingSuggestionRow({ status: 'discarded' })]);

      await discardSuggestion({ orgId: 'org-1', suggestionId: 'suggestion-1', profileId: 'profile-1' });

      expect(setAssistantMessageSendStatusMock).toHaveBeenCalledWith('msg-1', 'shadow_discarded');
      expect(recordAgentEventMock).toHaveBeenCalledWith(expect.objectContaining({ kind: 'suggestion_discarded' }));
    });

    it('is a no-op when there is no pending suggestion to discard', async () => {
      updateQueue.push([]);
      await discardSuggestion({ orgId: 'org-1', suggestionId: 'suggestion-1', profileId: 'profile-1' });
      expect(setAssistantMessageSendStatusMock).not.toHaveBeenCalled();
      expect(recordAgentEventMock).not.toHaveBeenCalled();
    });
  });
});
