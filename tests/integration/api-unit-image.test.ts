/**
 * Integration tests for GET /api/unit-image Route Handler.
 *
 * All Supabase and storage calls are mocked — no live DB or bucket required.
 *
 * Covers:
 *   AC7  — tenant gets signed URL for own unit (200)
 *   AC8  — tenant cannot get signed URL for a different unit (404)
 *   AC9  — cross-org path query returns 403
 *   AC25 — path traversal attempt returns 400/403
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
  tenantUnitId: string | null;
  signedUrlError: boolean;
}

const mockState: MockState = {
  role: 'tenant',
  orgId: 'org-acme',
  userId: 'user-tenant-001',
  tenantUnitId: 'unit-u1',
  signedUrlError: false,
};

function resetMockState() {
  mockState.role = 'tenant';
  mockState.orgId = 'org-acme';
  mockState.userId = 'user-tenant-001';
  mockState.tenantUnitId = 'unit-u1';
  mockState.signedUrlError = false;
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
  requireAdmin: vi.fn(async () => {
    if (mockState.role !== 'admin') throw new Error('FORBIDDEN');
    return {
      userId: mockState.userId,
      orgId: mockState.orgId,
      role: 'admin',
      profile: { id: mockState.userId, org_id: mockState.orgId, role: 'admin' },
    };
  }),
}));

// ---------------------------------------------------------------------------
// Mock: @/lib/supabase/server
// ---------------------------------------------------------------------------

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: {
      getUser: async () => ({
        data: { user: { id: mockState.userId } },
        error: null,
      }),
    },
    from: vi.fn((table: string) => {
      const chain: Record<string, unknown> = {};
      const stub = () => chain;
      chain.select = vi.fn(stub);
      chain.eq = vi.fn(stub);
      chain.single = vi.fn(() => {
        if (table === 'tenants') {
          return Promise.resolve({
            data: mockState.tenantUnitId ? { unit_id: mockState.tenantUnitId } : null,
            error: null,
          });
        }
        return Promise.resolve({ data: null, error: null });
      });
      return chain;
    }),
  })),
}));

// ---------------------------------------------------------------------------
// Mock: @/lib/storage/index
// ---------------------------------------------------------------------------

vi.mock('@/lib/storage/index', () => ({
  getSignedUrl: vi.fn(async (_bucket: string, path: string) => {
    if (mockState.signedUrlError) throw new Error('Supabase storage error');
    return `https://signed.supabase.co/object/sign/unit-images/${path}?token=abc123`;
  }),
  uploadImage: vi.fn(async () => ({ path: '' })),
  deleteImage: vi.fn(async () => undefined),
  validateImageFile: vi.fn(() => ({ valid: true, sniffedMime: 'image/jpeg' })),
  buildStoragePath: vi.fn(() => 'org/unit/uuid.jpg'),
  ALLOWED_MIME_TYPES: ['image/jpeg', 'image/png', 'image/webp'],
  MAX_IMAGES_PER_UNIT: 20,
  DEFAULT_SIGNED_URL_TTL_S: 3600,
}));

// ---------------------------------------------------------------------------
// Import handler AFTER mocks
// ---------------------------------------------------------------------------

import { GET } from '@/app/api/unit-image/route';

// ---------------------------------------------------------------------------
// Helper: build NextRequest
// ---------------------------------------------------------------------------

function makeRequest(path: string): NextRequest {
  const url = new URL(`http://localhost:3000/api/unit-image?path=${encodeURIComponent(path)}`);
  return new NextRequest(url);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  resetMockState();
  vi.clearAllMocks();
});

// ── AC7: Tenant reads own unit image ─────────────────────────────────────────

describe('AC7 — tenant gets signed URL for own unit image', () => {
  it('returns 200 with url and expiresIn for valid own-unit path', async () => {
    mockState.role = 'tenant';
    mockState.tenantUnitId = 'unit-u1';

    const response = await GET(makeRequest('org-acme/unit-u1/uuid.jpg'));
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.url).toContain('signed');
    expect(body.expiresIn).toBe(3600);
  });

  it('returns 200 for admin accessing own org path', async () => {
    mockState.role = 'admin';

    const response = await GET(makeRequest('org-acme/unit-u1/some-uuid.jpg'));
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.url).toContain('signed');
  });
});

// ── AC8: Tenant cannot read images of a different unit ───────────────────────

describe('AC8 — tenant cannot read images of a unit they do not occupy', () => {
  it('returns 404 when tenant requests a path for a different unit', async () => {
    mockState.role = 'tenant';
    mockState.tenantUnitId = 'unit-u1'; // tenant is assigned to unit-u1

    // Request a different unit's image (unit-u2)
    const response = await GET(makeRequest('org-acme/unit-u2/uuid.jpg'));
    expect(response.status).toBe(404);

    const body = await response.json();
    expect(body.error?.code).toBe('NOT_FOUND');
  });

  it('returns 404 when tenant has no assigned unit', async () => {
    mockState.role = 'tenant';
    mockState.tenantUnitId = null; // no unit assigned

    const response = await GET(makeRequest('org-acme/unit-u1/uuid.jpg'));
    expect(response.status).toBe(404);
  });
});

// ── AC9: Cross-org path query rejected ───────────────────────────────────────

describe('AC9 — cross-org signed URL path returns 404', () => {
  it('returns 404 when admin requests a path for a different org', async () => {
    mockState.role = 'admin';
    mockState.orgId = 'org-acme';

    // Path starts with org-beta — different org
    const response = await GET(makeRequest('org-beta/unit-u1/uuid.jpg'));
    expect(response.status).toBe(404);

    const body = await response.json();
    expect(body.error?.code).toBe('NOT_FOUND');
  });

  it('returns 404 when tenant requests a path for a different org', async () => {
    mockState.role = 'tenant';
    mockState.orgId = 'org-acme';
    mockState.tenantUnitId = 'unit-u1';

    const response = await GET(makeRequest('org-other/unit-u1/uuid.jpg'));
    expect(response.status).toBe(404);
  });
});

// ── AC25: Path traversal ──────────────────────────────────────────────────────

describe('AC25 — path traversal attempts are rejected', () => {
  it('returns 400 for a path containing ../', async () => {
    const response = await GET(makeRequest('../../../etc/passwd'));
    expect(response.status).toBe(400);
  });

  it('returns 400 for a path with null byte', async () => {
    const response = await GET(makeRequest('org-acme/unit-u1/file\0.jpg'));
    expect(response.status).toBe(400);
  });

  it('returns 400 when path has too few segments (no unit_id)', async () => {
    // Only 2 segments instead of required 3
    const response = await GET(makeRequest('org-acme/uuid.jpg'));
    expect(response.status).toBe(400);
  });

  it('returns 400 when path has too many segments', async () => {
    const response = await GET(makeRequest('org-acme/unit-u1/subdir/uuid.jpg'));
    expect(response.status).toBe(400);
  });

  it('returns 400 when path is missing (no query param)', async () => {
    const url = new URL('http://localhost:3000/api/unit-image');
    const request = new NextRequest(url);
    const response = await GET(request);
    expect(response.status).toBe(400);
  });

  it('returns 400 for path with ../ in the middle', async () => {
    const response = await GET(makeRequest('org-acme/../org-beta/unit-u1/file.jpg'));
    expect(response.status).toBe(400);
  });
});

// ── Edge cases ────────────────────────────────────────────────────────────────

describe('Edge cases', () => {
  it('returns 500 on signed URL generation failure (no internals leaked)', async () => {
    mockState.role = 'admin';
    mockState.signedUrlError = true;

    const response = await GET(makeRequest('org-acme/unit-u1/uuid.jpg'));
    expect(response.status).toBe(500);

    const body = await response.json();
    // Must not leak internal error details
    expect(body.error?.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(body)).not.toContain('Supabase storage error');
  });

  it('returns 401 for unauthenticated request', async () => {
    const { requireUser } = await import('@/lib/auth/guards');
    vi.mocked(requireUser).mockRejectedValueOnce(new Error('UNAUTHORIZED'));

    const response = await GET(makeRequest('org-acme/unit-u1/uuid.jpg'));
    expect(response.status).toBe(401);
  });
});
