/**
 * Unit tests: src/lib/portal-preview/queries.ts (Drizzle version)
 *
 * Functions no longer accept a Supabase client — they use @/lib/db directly.
 * We mock @/lib/db and verify:
 *   - Return shapes are correct
 *   - Short-circuit on profileId=null (no DB call)
 *   - Error handling returns []
 *   - getPortalPreviewAISessions groups messages by session_id
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getPortalPreviewVisitors,
  getPortalPreviewNotifications,
  getPortalPreviewAnnouncements,
  getPortalPreviewAISessions,
  getPortalPreviewRecentPayments,
  getPortalPreviewRecentIncidents,
} from '@/lib/portal-preview/queries';

// ---------------------------------------------------------------------------
// Mock @/lib/db — configurable per test
// ---------------------------------------------------------------------------

let mockSelectRows: unknown[] = [];
let mockShouldThrow = false;

const mockSelectChain = {
  from: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  innerJoin: vi.fn().mockReturnThis(),
  orderBy: vi.fn().mockReturnThis(),
  limit: vi.fn(async () => {
    if (mockShouldThrow) throw new Error('DB error');
    return mockSelectRows;
  }),
};

vi.mock('@/lib/db', () => ({
  db: {
    select: vi.fn(() => mockSelectChain),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockSelectRows = [];
  mockShouldThrow = false;
  // Reset chain methods to use the latest mockSelectRows/mockShouldThrow
  mockSelectChain.from.mockReturnThis();
  mockSelectChain.where.mockReturnThis();
  mockSelectChain.innerJoin.mockReturnThis();
  mockSelectChain.orderBy.mockReturnThis();
  mockSelectChain.limit.mockImplementation(async () => {
    if (mockShouldThrow) throw new Error('DB error');
    return mockSelectRows;
  });
});

const tenantId = 'tenant-uuid-123';
const orgId = 'org-uuid-abc';
const profileId = 'profile-uuid-456';
const unitId = 'unit-uuid-789';
const propertyId = 'property-uuid-321';

// ---------------------------------------------------------------------------
// AC7: getPortalPreviewVisitors
// ---------------------------------------------------------------------------

describe('getPortalPreviewVisitors (AC7)', () => {
  it('returns mapped visitor rows', async () => {
    mockSelectRows = [{
      id: 'v1',
      visitorName: 'Alice',
      purpose: 'visit',
      visitDate: '2026-06-01',
      entryTime: new Date('2026-06-01T10:00:00Z'),
      exitTime: null,
      hostTenantId: tenantId,
      unitId: 'unit-1',
      orgId,
    }];
    const result = await getPortalPreviewVisitors(tenantId, orgId);
    expect(result).toHaveLength(1);
    expect(result[0].visitor_name).toBe('Alice');
  });

  it('returns empty array when no rows', async () => {
    mockSelectRows = [];
    const result = await getPortalPreviewVisitors(tenantId, orgId);
    expect(result).toEqual([]);
  });

  it('returns empty array on query error (no throw)', async () => {
    mockShouldThrow = true;
    const result = await getPortalPreviewVisitors(tenantId, orgId);
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// AC8: getPortalPreviewNotifications
// ---------------------------------------------------------------------------

describe('getPortalPreviewNotifications (AC8)', () => {
  it('returns [] immediately when profileId is null — NO DB call (IC5)', async () => {
    const { db } = await import('@/lib/db');
    const result = await getPortalPreviewNotifications(null, orgId);
    expect(result).toEqual([]);
    expect(db.select).not.toHaveBeenCalled();
  });

  it('returns notification rows when profileId is present', async () => {
    mockSelectRows = [{
      id: 'n1',
      title: 'Payment due',
      body: 'Your rent is due tomorrow.',
      createdAt: new Date('2026-06-01T09:00:00Z'),
      readAt: null,
      profileId,
      orgId,
    }];
    const result = await getPortalPreviewNotifications(profileId, orgId);
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('Payment due');
  });

  it('returns empty array on query error (no throw)', async () => {
    mockShouldThrow = true;
    const result = await getPortalPreviewNotifications(profileId, orgId);
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// AC9: getPortalPreviewAnnouncements
// ---------------------------------------------------------------------------

describe('getPortalPreviewAnnouncements (AC9)', () => {
  it('returns announcement rows', async () => {
    mockSelectRows = [{
      id: 'ann-1',
      title: 'Maintenance',
      body: 'Water will be cut off Sunday.',
      audience: 'all',
      publishedAt: new Date('2026-06-01T08:00:00Z'),
      expiresAt: null,
      unitId: null,
      propertyId: null,
      orgId,
    }];
    const result = await getPortalPreviewAnnouncements(unitId, propertyId, orgId);
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('Maintenance');
  });

  it('returns empty array on query error (no throw)', async () => {
    mockShouldThrow = true;
    const result = await getPortalPreviewAnnouncements(unitId, propertyId, orgId);
    expect(result).toEqual([]);
  });

  it('returns empty array when no rows match', async () => {
    mockSelectRows = [];
    const result = await getPortalPreviewAnnouncements(null, null, orgId);
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// AC10: getPortalPreviewAISessions
// ---------------------------------------------------------------------------

describe('getPortalPreviewAISessions (AC10)', () => {
  it('returns [] immediately when profileId is null — NO DB call (IC5)', async () => {
    const { db } = await import('@/lib/db');
    const result = await getPortalPreviewAISessions(null, orgId);
    expect(result).toEqual([]);
    expect(db.select).not.toHaveBeenCalled();
  });

  it('returns [] when no messages', async () => {
    mockSelectRows = [];
    const result = await getPortalPreviewAISessions(profileId, orgId);
    expect(result).toEqual([]);
  });

  it('passes messages to groupAISessions and returns grouped AISession[]', async () => {
    const sessionId1 = 'session-aaa-111';
    const sessionId2 = 'session-bbb-222';
    mockSelectRows = [
      { id: 'm1', sessionId: sessionId1, role: 'user', content: 'Hello', createdAt: new Date('2026-06-01T10:00:00Z'), profileId, orgId },
      { id: 'm2', sessionId: sessionId1, role: 'assistant', content: 'Hi there', createdAt: new Date('2026-06-01T10:01:00Z'), profileId, orgId },
      { id: 'm3', sessionId: sessionId2, role: 'user', content: 'What is my balance?', createdAt: new Date('2026-06-02T09:00:00Z'), profileId, orgId },
    ];
    const result = await getPortalPreviewAISessions(profileId, orgId);
    expect(result).toHaveLength(2);
    // Sorted by started_at DESC — session2 (June 2) first
    expect(result[0].session_id).toBe(sessionId2);
    expect(result[0].message_count).toBe(1);
    expect(result[1].session_id).toBe(sessionId1);
    expect(result[1].message_count).toBe(2);
  });

  it('returns empty array on query error (no throw)', async () => {
    mockShouldThrow = true;
    const result = await getPortalPreviewAISessions(profileId, orgId);
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// B2: getPortalPreviewRecentPayments
// ---------------------------------------------------------------------------

describe('getPortalPreviewRecentPayments (B2)', () => {
  it('returns payment rows with expected fields', async () => {
    mockSelectRows = [
      { id: 'pay-1', amount: '1200', paidAt: new Date('2026-06-01T10:00:00Z'), status: 'approved', method: 'bank_transfer' },
      { id: 'pay-2', amount: '1200', paidAt: new Date('2026-05-01T10:00:00Z'), status: 'approved', method: 'cash' },
    ];
    const result = await getPortalPreviewRecentPayments(tenantId, orgId);
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('pay-1');
    expect(result[0].amount).toBe(1200);
    expect(result[0].status).toBe('approved');
  });

  it('returns empty array on query error (no throw)', async () => {
    mockShouldThrow = true;
    const result = await getPortalPreviewRecentPayments(tenantId, orgId);
    expect(result).toEqual([]);
  });

  it('returns empty array when no rows', async () => {
    mockSelectRows = [];
    const result = await getPortalPreviewRecentPayments(tenantId, orgId);
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// B2: getPortalPreviewRecentIncidents
// ---------------------------------------------------------------------------

describe('getPortalPreviewRecentIncidents (B2)', () => {
  it('returns incident rows with expected fields', async () => {
    mockSelectRows = [
      { id: 'inc-1', title: 'Water leak in bathroom', status: 'open', createdAt: new Date('2026-06-01T08:00:00Z') },
      { id: 'inc-2', title: 'Broken window', status: 'resolved', createdAt: new Date('2026-05-20T09:00:00Z') },
    ];
    const result = await getPortalPreviewRecentIncidents(tenantId, orgId);
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('inc-1');
    expect(result[0].title).toBe('Water leak in bathroom');
    expect(result[0].status).toBe('open');
  });

  it('returns empty array on query error (no throw)', async () => {
    mockShouldThrow = true;
    const result = await getPortalPreviewRecentIncidents(tenantId, orgId);
    expect(result).toEqual([]);
  });

  it('returns empty array when no rows', async () => {
    mockSelectRows = [];
    const result = await getPortalPreviewRecentIncidents(tenantId, orgId);
    expect(result).toEqual([]);
  });
});
