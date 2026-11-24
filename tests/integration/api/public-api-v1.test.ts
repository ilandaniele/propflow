import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { generateApiKey } from '@/lib/api-keys/token';
import { sha256 } from '@/lib/crypto/hash';

const ORG_ID = '550e8400-e29b-41d4-a716-446655440001';
const KEY_ID = '550e8400-e29b-41d4-a716-446655440002';

const mockClaim = vi.fn();
vi.mock('@/lib/api-keys/queries', () => ({ claimActiveApiKey: (...a: unknown[]) => mockClaim(...a) }));

const mockRateLimit = vi.fn();
vi.mock('@/lib/ratelimit', () => ({ actionRateLimit: (...a: unknown[]) => mockRateLimit(...a) }));

const mockListPayments = vi.fn();
const mockListProperties = vi.fn();
vi.mock('@/lib/public-api/queries', () => ({
  listPaymentsForApi: (...a: unknown[]) => mockListPayments(...a),
  listPropertiesForApi: (...a: unknown[]) => mockListProperties(...a),
}));

const { token } = generateApiKey();

function request(path: string, authorization: string | null = `Bearer ${token}`) {
  const headers = authorization ? { authorization } : undefined;
  return new NextRequest(`http://localhost${path}`, { headers });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockClaim.mockResolvedValue({ id: KEY_ID, orgId: ORG_ID });
  mockRateLimit.mockReturnValue({ success: true, retryAfterMs: 0 });
});

describe('GET /api/v1/*', () => {
  it('401 without a bearer token and never touches the DB', async () => {
    const { GET } = await import('@/app/api/v1/properties/route');
    const res = await GET(request('/api/v1/properties', null));
    expect(res.status).toBe(401);
    expect(mockClaim).not.toHaveBeenCalled();
  });

  it('401 for an unknown or revoked key', async () => {
    mockClaim.mockResolvedValue(null);
    const { GET } = await import('@/app/api/v1/properties/route');
    const res = await GET(request('/api/v1/properties'));
    expect(res.status).toBe(401);
    expect(mockClaim).toHaveBeenCalledWith(sha256(token));
  });

  it('429 when the key exceeds its rate limit', async () => {
    mockRateLimit.mockReturnValue({ success: false, retryAfterMs: 1000 });
    const { GET } = await import('@/app/api/v1/properties/route');
    const res = await GET(request('/api/v1/properties'));
    expect(res.status).toBe(429);
    expect(mockListProperties).not.toHaveBeenCalled();
  });

  it.each(['limit=500', 'offset=-3', 'month=2026-13', 'status=paid'])('400 on invalid query %s', async (query) => {
    const { GET } = await import('@/app/api/v1/payments/route');
    const res = await GET(request(`/api/v1/payments?${query}`));
    expect(res.status).toBe(400);
    expect(mockListPayments).not.toHaveBeenCalled();
  });

  it('200 scoped to the key org with pagination', async () => {
    mockListPayments.mockResolvedValue([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
    const { GET } = await import('@/app/api/v1/payments/route');
    const res = await GET(request('/api/v1/payments?month=2026-11&status=approved&limit=2&offset=4'));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({
      data: [{ id: 'a' }, { id: 'b' }],
      pagination: { limit: 2, offset: 4, hasMore: true },
    });
    expect(mockListPayments).toHaveBeenCalledWith(
      ORG_ID,
      { limit: 2, offset: 4 },
      expect.objectContaining({ month: '2026-11', status: 'approved' }),
    );
  });

  it('500 with a generic message when the query fails', async () => {
    mockListProperties.mockRejectedValue(new Error('D1 exploded'));
    const { GET } = await import('@/app/api/v1/properties/route');
    const res = await GET(request('/api/v1/properties'));
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain('D1 exploded');
  });
});
