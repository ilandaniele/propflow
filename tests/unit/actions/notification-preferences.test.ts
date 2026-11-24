import { describe, it, expect, vi, beforeEach } from 'vitest';

const ORG_UUID = '550e8400-e29b-41d4-a716-446655440010';
const PROFILE_UUID = '550e8400-e29b-41d4-a716-446655440014';

const mockState = {
  role: 'tenant' as 'admin' | 'tenant' | null,
  rateLimitSuccess: true,
};

vi.mock('@/lib/auth/guards', () => ({
  requireTenant: vi.fn().mockImplementation(async () => {
    if (mockState.role === null) throw new Error('UNAUTHORIZED');
    if (mockState.role !== 'tenant') throw new Error('FORBIDDEN');
    return { userId: PROFILE_UUID, orgId: ORG_UUID, role: 'tenant', profile: { id: PROFILE_UUID } };
  }),
}));

vi.mock('@/lib/ratelimit', () => ({
  mutationRateLimit: vi.fn().mockImplementation(() => ({ success: mockState.rateLimitSuccess })),
}));

vi.mock('@/lib/log', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const mockSaveEmailPreferences = vi.fn();
vi.mock('@/lib/notifications/preferences', () => ({
  saveEmailPreferences: (...args: unknown[]) => mockSaveEmailPreferences(...args),
}));

import { updateEmailPreferences } from '@/app/actions/notificationPreferences';

function form(entries: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.set(k, v);
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockState.role = 'tenant';
  mockState.rateLimitSuccess = true;
  mockSaveEmailPreferences.mockResolvedValue(undefined);
});

describe('updateEmailPreferences', () => {
  it('saves the caller own preferences from the session, never from the form', async () => {
    const result = await updateEmailPreferences({}, form({ lease_renewal: 'on', profile_id: 'someone-else', org_id: 'other-org' }));

    expect(result.error).toBeUndefined();
    expect(mockSaveEmailPreferences).toHaveBeenCalledWith(ORG_UUID, PROFILE_UUID, { lease_renewal: true, payment_due: false });
  });

  it('rejects an unauthenticated caller', async () => {
    mockState.role = null;
    const result = await updateEmailPreferences({}, form({}));
    expect(result.error?.code).toBe('UNAUTHORIZED');
    expect(mockSaveEmailPreferences).not.toHaveBeenCalled();
  });

  it('rejects a non-tenant caller', async () => {
    mockState.role = 'admin';
    const result = await updateEmailPreferences({}, form({}));
    expect(result.error?.code).toBe('UNAUTHORIZED');
    expect(mockSaveEmailPreferences).not.toHaveBeenCalled();
  });

  it('is rate limited', async () => {
    mockState.rateLimitSuccess = false;
    const result = await updateEmailPreferences({}, form({}));
    expect(result.error?.code).toBe('RATE_LIMITED');
    expect(mockSaveEmailPreferences).not.toHaveBeenCalled();
  });

  it('rejects an invalid checkbox value', async () => {
    const result = await updateEmailPreferences({}, form({ payment_due: 'maybe' }));
    expect(result.error?.code).toBe('VALIDATION_ERROR');
    expect(mockSaveEmailPreferences).not.toHaveBeenCalled();
  });

  it('returns a generic error when the save fails', async () => {
    mockSaveEmailPreferences.mockRejectedValue(new Error('db down'));
    const result = await updateEmailPreferences({}, form({}));
    expect(result.error?.code).toBe('INTERNAL_ERROR');
  });
});
