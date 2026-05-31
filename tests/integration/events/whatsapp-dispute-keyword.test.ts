/**
 * Integration test: dispute keyword handler marks sanction as disputed.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockUpdate = vi.fn().mockReturnValue({
  eq: () => ({ eq: () => ({ eq: async () => ({ error: null }) }) }),
});
const mockSanctionSelect = vi.fn().mockReturnValue({
  eq: () => ({
    eq: () => ({
      eq: () => ({
        gte: () => ({
          order: () => ({
            limit: () => ({
              single: async () => ({
                data: { id: 'sanction-1', title: 'Noise fine', tenant_id: 'tenant-1', org_id: 'org-1' },
                error: null,
              }),
            }),
          }),
        }),
      }),
    }),
  }),
});

const mockInsert = vi.fn().mockResolvedValue({ data: null, error: null });
const mockAdminSelect = vi.fn().mockReturnValue({
  eq: () => ({ eq: () => ({ limit: () => ({ single: async () => ({ data: { id: 'admin-1' }, error: null }) }) }) }),
});

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === 'sanctions') return { select: mockSanctionSelect, update: mockUpdate };
      if (table === 'notification_inbox') return { insert: mockInsert };
      if (table === 'profiles') return { select: mockAdminSelect };
      return {};
    },
  }),
}));

import { handleWhatsAppDisputeKeyword } from '@/lib/events/handlers/whatsapp-dispute-keyword';

describe('handleWhatsAppDisputeKeyword', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const disputeKeywords = ['disputar', 'dispute', 'disputo', 'contestar'];

  disputeKeywords.forEach((keyword) => {
    it(`detects keyword "${keyword}" and marks sanction disputed`, async () => {
      await handleWhatsAppDisputeKeyword(
        {
          orgId: 'org-1',
          conversationId: 'conv-1',
          messageId: 'msg-1',
          tenantId: 'tenant-1',
          body: `Quiero ${keyword} la multa`,
        },
        'test-key'
      );

      expect(mockInsert).toHaveBeenCalledOnce();
    });
  });

  it('does nothing when no dispute keyword in body', async () => {
    await handleWhatsAppDisputeKeyword(
      {
        orgId: 'org-1',
        conversationId: 'conv-1',
        messageId: 'msg-1',
        tenantId: 'tenant-1',
        body: 'Hola, queria consultar sobre el alquiler',
      },
      'test-key'
    );

    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('does nothing when tenantId is null', async () => {
    await handleWhatsAppDisputeKeyword(
      {
        orgId: 'org-1',
        conversationId: 'conv-1',
        messageId: 'msg-1',
        tenantId: null,
        body: 'disputar',
      },
      'test-key'
    );

    expect(mockInsert).not.toHaveBeenCalled();
  });
});
