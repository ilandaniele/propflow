/**
 * Integration test: sanction.approved handler sends notification.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock: @/lib/db (Drizzle)
// ---------------------------------------------------------------------------

const mockInsert = vi.fn();
const mockSelectLimit = vi.fn();

vi.mock('@/lib/db', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: mockSelectLimit,
    })),
    insert: vi.fn(() => ({
      values: mockInsert,
    })),
  },
}));

import { handleSanctionApproved } from '@/lib/events/handlers/sanction-approved';

describe('handleSanctionApproved', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: tenant + sanction rows returned
    mockSelectLimit
      .mockResolvedValueOnce([{ profileId: 'profile-1', fullName: 'Test Tenant' }])  // tenants query
      .mockResolvedValueOnce([{ title: 'Noise fine', amount: 50 }]);                  // sanctions query
    mockInsert.mockResolvedValue([]);
  });

  it('sends notification when sanction has chargeId', async () => {
    await handleSanctionApproved({
      orgId: 'org-1',
      sanctionId: 'sanction-1',
      tenantId: 'tenant-1',
      chargeId: 'charge-1',
    });

    expect(mockInsert).toHaveBeenCalledOnce();
    const insertArg = mockInsert.mock.calls[0][0];
    expect(insertArg.type).toBe('sanction_approved');
  });

  it('does nothing when chargeId is null (warning sanction)', async () => {
    await handleSanctionApproved({
      orgId: 'org-1',
      sanctionId: 'sanction-2',
      tenantId: 'tenant-1',
      chargeId: null,
    });

    expect(mockInsert).not.toHaveBeenCalled();
  });
});
