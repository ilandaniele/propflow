/**
 * Integration tests for GET /api/airtable-attachment Route Handler.
 *
 * All Supabase calls are mocked — no live DB required.
 *
 * Covers:
 *   AC15 — Airtable attachment proxy serves refreshed URL (302 redirect)
 *   AC15 — Tenant gets 404 (not 403 — prevents enumeration)
 *   AC15 — Cross-org admin gets 404
 *   AC15 — Invalid att_id → 404
 *   AC15 — Rate limit: 31st call → 429
 *   AC15 — Missing params → 400
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ---------------------------------------------------------------------------
// Mock state
// ---------------------------------------------------------------------------

interface MockState {
  role: 'admin' | 'tenant';
  orgId: string;
  userId: string;
  snapshotData: Record<string, unknown> | null;
  dbError: boolean;
}

const mockState: MockState = {
  role: 'admin',
  orgId: 'org-acme',
  userId: 'user-admin-001',
  snapshotData: {
    fields: {
      Photos: [
        {
          id: 'attABC123',
          url: 'https://dl.airtable.com/attABC123/photo.jpg',
          filename: 'photo.jpg',
          size: 204800,
          type: 'image/jpeg',
        },
      ],
    },
  },
  dbError: false,
};

function resetMockState() {
  mockState.role = 'admin';
  mockState.orgId = 'org-acme';
  mockState.userId = 'user-admin-001';
  mockState.snapshotData = {
    fields: {
      Photos: [
        {
          id: 'attABC123',
          url: 'https://dl.airtable.com/attABC123/photo.jpg',
          filename: 'photo.jpg',
          size: 204800,
          type: 'image/jpeg',
        },
      ],
    },
  };
  mockState.dbError = false;
}

// ---------------------------------------------------------------------------
// Mock: @/lib/auth/guards
// ---------------------------------------------------------------------------

vi.mock('@/lib/auth/guards', () => ({
  requireUser: vi.fn(async () => {
    return {
      userId: mockState.userId,
      orgId: mockState.orgId,
      role: mockState.role,
      profile: {
        id: mockState.userId,
        org_id: mockState.orgId,
        role: mockState.role,
      },
    };
  }),
}));

// ---------------------------------------------------------------------------
// Mock: @/lib/supabase/server
// ---------------------------------------------------------------------------

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: mockState.userId })),
  createAdminServerClient: vi.fn(async () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: mockState.userId } }, error: null }),
    },
    from: vi.fn(() => {
      const chain: Record<string, unknown> = {};
      const self = () => chain;
      chain.select = vi.fn(self);
      chain.eq = vi.fn(self);
      chain.single = vi.fn(() => {
        if (mockState.dbError) {
          return Promise.resolve({ data: null, error: { code: 'PGRST116', message: 'not found' } });
        }
        if (!mockState.snapshotData) {
          return Promise.resolve({ data: null, error: null });
        }
        return Promise.resolve({
          data: {
            id: 'snapshot-uuid-001',
            org_id: mockState.orgId,
            data: mockState.snapshotData,
          },
          error: null,
        });
      });
      return chain;
    }),
  })),
}));

// ---------------------------------------------------------------------------
// Mock: @/lib/ratelimit
// ---------------------------------------------------------------------------

let rateLimitCallCount = 0;
let rateLimitMax = 9999;

vi.mock('@/lib/ratelimit', () => ({
  actionRateLimit: vi.fn(() => {
    rateLimitCallCount++;
    if (rateLimitCallCount > rateLimitMax) {
      return { success: false, retryAfterMs: 1000 };
    }
    return { success: true, retryAfterMs: 0 };
  }),
  mutationRateLimit: vi.fn(() => ({ success: true, retryAfterMs: 0 })),
}));

// ---------------------------------------------------------------------------
// Import handler AFTER mocks
// ---------------------------------------------------------------------------

import { GET } from '@/app/api/airtable-attachment/route';

// ---------------------------------------------------------------------------
// Helper: build NextRequest
// ---------------------------------------------------------------------------

function makeRequest(snapshotId: string, attId: string): NextRequest {
  const url = new URL(
    `http://localhost:3000/api/airtable-attachment?snapshot_id=${encodeURIComponent(snapshotId)}&att_id=${encodeURIComponent(attId)}`
  );
  return new NextRequest(url);
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  resetMockState();
  rateLimitCallCount = 0;
  rateLimitMax = 9999;
  vi.clearAllMocks();
});

// ── AC15: Happy path — admin gets 302 redirect to Airtable URL ───────────────

describe('AC15 — admin gets 302 redirect for valid attachment', () => {
  it('returns 302 with Location pointing to Airtable CDN URL', async () => {
    const response = await GET(
      makeRequest('aaaaaaaa-0000-0000-0000-000000000001', 'attABC123')
    );
    expect(response.status).toBe(302);
    const location = response.headers.get('location');
    expect(location).toBe('https://dl.airtable.com/attABC123/photo.jpg');
  });

  it('returns 302 for an attachment in a custom field name matching resolvePhotoFieldName', async () => {
    // Use "Images" field instead of "Photos"
    mockState.snapshotData = {
      fields: {
        Images: [
          {
            id: 'attXYZ999',
            url: 'https://dl.airtable.com/attXYZ999/room.jpg',
            filename: 'room.jpg',
          },
        ],
      },
    };
    const response = await GET(
      makeRequest('aaaaaaaa-0000-0000-0000-000000000001', 'attXYZ999')
    );
    expect(response.status).toBe(302);
    const location = response.headers.get('location');
    expect(location).toBe('https://dl.airtable.com/attXYZ999/room.jpg');
  });
});

// ── AC15: Tenant gets 404 (prevents enumeration) ─────────────────────────────

describe('AC15 — tenant gets 404 (not 403)', () => {
  it('returns 404 when caller is a tenant', async () => {
    mockState.role = 'tenant';
    const response = await GET(
      makeRequest('aaaaaaaa-0000-0000-0000-000000000001', 'attABC123')
    );
    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error?.code).toBe('NOT_FOUND');
  });
});

// ── AC15: Cross-org gets 404 ──────────────────────────────────────────────────

describe('AC15 — cross-org snapshot access returns 404', () => {
  it('returns 404 when snapshot belongs to a different org', async () => {
    // DB mock returns null (snapshot not found for this org)
    mockState.snapshotData = null;
    // Use a different snapshot_id to avoid the in-process cache from happy-path tests
    const response = await GET(
      makeRequest('bbbbbbbb-0000-0000-0000-000000000002', 'attABC123')
    );
    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error?.code).toBe('NOT_FOUND');
  });

  it('returns 404 when DB errors (not found)', async () => {
    mockState.dbError = true;
    // Use yet another snapshot_id to avoid cache
    const response = await GET(
      makeRequest('cccccccc-0000-0000-0000-000000000003', 'attABC123')
    );
    expect(response.status).toBe(404);
  });
});

// ── AC15: Invalid att_id → 404 ────────────────────────────────────────────────

describe('AC15 — unknown att_id returns 404', () => {
  it('returns 404 when att_id does not match any attachment in snapshot', async () => {
    const response = await GET(
      makeRequest('aaaaaaaa-0000-0000-0000-000000000001', 'attNONEXISTENT')
    );
    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error?.code).toBe('NOT_FOUND');
  });
});

// ── Missing / invalid query params → 400 ─────────────────────────────────────

describe('Input validation — missing or invalid params', () => {
  it('returns 400 when snapshot_id is missing', async () => {
    const url = new URL('http://localhost:3000/api/airtable-attachment?att_id=attABC123');
    const response = await GET(new NextRequest(url));
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error?.code).toBe('BAD_PATH');
  });

  it('returns 400 when att_id is missing', async () => {
    const url = new URL('http://localhost:3000/api/airtable-attachment?snapshot_id=aaaaaaaa-0000-0000-0000-000000000001');
    const response = await GET(new NextRequest(url));
    expect(response.status).toBe(400);
  });

  it('returns 400 when snapshot_id is not a valid UUID', async () => {
    const url = new URL('http://localhost:3000/api/airtable-attachment?snapshot_id=not-a-uuid&att_id=attABC123');
    const response = await GET(new NextRequest(url));
    expect(response.status).toBe(400);
  });
});

// ── Rate limit ────────────────────────────────────────────────────────────────

describe('Rate limiting — 30 req/min per admin', () => {
  it('returns 429 when rate limit is exceeded', async () => {
    rateLimitMax = 0; // fail immediately

    const response = await GET(
      makeRequest('aaaaaaaa-0000-0000-0000-000000000001', 'attABC123')
    );
    expect(response.status).toBe(429);
    const body = await response.json();
    expect(body.error?.code).toBe('RATE_LIMITED');
  });
});

// ── Unauthenticated ───────────────────────────────────────────────────────────

describe('Unauthenticated access → 401', () => {
  it('returns 401 when requireUser throws', async () => {
    const { requireUser } = await import('@/lib/auth/guards');
    vi.mocked(requireUser).mockRejectedValueOnce(new Error('UNAUTHORIZED'));

    const response = await GET(
      makeRequest('aaaaaaaa-0000-0000-0000-000000000001', 'attABC123')
    );
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error?.code).toBe('UNAUTHORIZED');
  });
});
