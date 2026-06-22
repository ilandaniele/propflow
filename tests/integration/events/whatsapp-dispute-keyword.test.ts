/**
 * Integration test: dispute keyword handler marks sanction as disputed.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock: @/lib/db (Drizzle)
// ---------------------------------------------------------------------------

const mockInsert = vi.fn().mockResolvedValue([]);
const mockUpdateReturning = vi.fn().mockResolvedValue([{ id: 'sanction-1' }]);
const mockSelectLimit = vi.fn();

vi.mock('@/lib/db', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: mockSelectLimit,
    })),
    insert: vi.fn(() => ({
      values: mockInsert,
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => ({
          returning: mockUpdateReturning,
        })),
      })),
    })),
  },
}));

import { handleWhatsAppDisputeKeyword } from '@/lib/events/handlers/whatsapp-dispute-keyword';

describe('handleWhatsAppDisputeKeyword', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: sanction found + admin profile found
    mockSelectLimit
      .mockResolvedValueOnce([{ id: 'sanction-1', title: 'Noise fine', tenantId: 'tenant-1', orgId: 'org-1' }])
      .mockResolvedValueOnce([{ id: 'admin-1' }]);
    mockInsert.mockResolvedValue([]);
    mockUpdateReturning.mockResolvedValue([{ id: 'sanction-1' }]);
  });

  const disputeKeywords = ['disputar', 'dispute', 'disputo', 'contestar'];

  disputeKeywords.forEach((keyword) => {
    it(`detects keyword "${keyword}" and marks sanction disputed`, async () => {
      await handleWhatsAppDisputeKeyword({
        orgId: 'org-1',
        conversationId: 'conv-1',
        messageId: 'msg-1',
        tenantId: 'tenant-1',
        body: `Quiero ${keyword} la multa`,
      });

      expect(mockInsert).toHaveBeenCalledOnce();
    });
  });

  it('does nothing when no dispute keyword in body', async () => {
    await handleWhatsAppDisputeKeyword({
      orgId: 'org-1',
      conversationId: 'conv-1',
      messageId: 'msg-1',
      tenantId: 'tenant-1',
      body: 'Hola, queria consultar sobre el alquiler',
    });

    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('does nothing when tenantId is null', async () => {
    await handleWhatsAppDisputeKeyword({
      orgId: 'org-1',
      conversationId: 'conv-1',
      messageId: 'msg-1',
      tenantId: null,
      body: 'disputar',
    });

    expect(mockInsert).not.toHaveBeenCalled();
  });
});
