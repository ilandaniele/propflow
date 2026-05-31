/**
 * Integration test: sanction.approved handler sends notification.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock admin client
const mockInsert = vi.fn().mockResolvedValue({ data: null, error: null });
const mockSelect = vi.fn().mockReturnValue({
  eq: () => ({ single: async () => ({ data: { profile_id: 'profile-1', full_name: 'Test Tenant' }, error: null }) }),
});
const mockSanctionSelect = vi.fn().mockReturnValue({
  eq: () => ({ single: async () => ({ data: { title: 'Noise fine', amount: 50 }, error: null }) }),
});

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === 'tenants') return { select: mockSelect };
      if (table === 'sanctions') return { select: mockSanctionSelect };
      if (table === 'notification_inbox') return { insert: mockInsert };
      return { select: () => ({ eq: () => ({ single: async () => ({ data: null }) }) }) };
    },
  }),
}));

import { handleSanctionApproved } from '@/lib/events/handlers/sanction-approved';

describe('handleSanctionApproved', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sends notification when sanction has chargeId', async () => {
    await handleSanctionApproved(
      {
        orgId: 'org-1',
        sanctionId: 'sanction-1',
        tenantId: 'tenant-1',
        chargeId: 'charge-1',
      },
      'test-key'
    );

    expect(mockInsert).toHaveBeenCalledOnce();
    const insertArg = mockInsert.mock.calls[0][0];
    expect(insertArg.type).toBe('sanction_approved');
  });

  it('does nothing when chargeId is null (warning sanction)', async () => {
    await handleSanctionApproved(
      {
        orgId: 'org-1',
        sanctionId: 'sanction-2',
        tenantId: 'tenant-1',
        chargeId: null,
      },
      'test-key'
    );

    expect(mockInsert).not.toHaveBeenCalled();
  });
});
