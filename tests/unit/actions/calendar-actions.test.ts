/**
 * Unit tests for the calendar Server Actions (item C).
 *
 * Covers (blueprint §4):
 * - disconnectCalendar only affects the caller's own profile.
 * - Drift resolution slot_taken maps to CONFLICT.
 * - Unauthenticated calls -> UNAUTHORIZED.
 *
 * Item B's modules (src/lib/calendar/connections.ts, src/lib/calendar/sync.ts)
 * are not built yet — they are mocked here per the blueprint's frozen
 * contracts (§3.2, §3.7), not stubbed as real files.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const ORG_UUID = '550e8400-e29b-41d4-a716-446655440010';
const PROFILE_UUID = '550e8400-e29b-41d4-a716-446655440014';
const VISIT_UUID = '550e8400-e29b-41d4-a716-446655440013';
const CONNECTION_UUID = '550e8400-e29b-41d4-a716-446655440020';

const mockState = {
  adminRole: 'admin' as 'admin' | 'tenant' | null,
  rateLimitSuccess: true,
};

vi.mock('@/lib/auth/guards', () => ({
  requireAdmin: vi.fn().mockImplementation(async () => {
    if (mockState.adminRole !== 'admin') throw new Error('UNAUTHORIZED');
    return { userId: 'admin-uuid', orgId: ORG_UUID, role: 'admin', profile: { id: PROFILE_UUID, email: 'advisor@propflow.test' } };
  }),
}));

vi.mock('@/lib/ratelimit', () => ({
  mutationRateLimit: vi.fn().mockImplementation(() => ({ success: mockState.rateLimitSuccess })),
}));

vi.mock('@/lib/log', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), adminAction: vi.fn() },
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const mockDisconnectConnection = vi.fn();
const mockUpdateConnectionSettings = vi.fn();
const mockGetConnectionForProfile = vi.fn();

vi.mock('@/lib/calendar/connections', () => ({
  disconnectConnection: (...args: unknown[]) => mockDisconnectConnection(...args),
  updateConnectionSettings: (...args: unknown[]) => mockUpdateConnectionSettings(...args),
  getConnectionForProfile: (...args: unknown[]) => mockGetConnectionForProfile(...args),
}));

const mockResolveVisitDrift = vi.fn();

vi.mock('@/lib/calendar/sync', () => ({
  resolveVisitDrift: (...args: unknown[]) => mockResolveVisitDrift(...args),
}));

const mockEnqueueJob = vi.fn();

vi.mock('@/lib/agent/jobs', () => ({
  enqueueJob: (...args: unknown[]) => mockEnqueueJob(...args),
}));

import { disconnectCalendar, resolveCalendarDrift, resyncCalendarNow, updateCalendarSettings } from '@/app/actions/calendar';

beforeEach(() => {
  vi.clearAllMocks();
  mockState.adminRole = 'admin';
  mockState.rateLimitSuccess = true;
  mockDisconnectConnection.mockImplementation(async () => true);
  mockUpdateConnectionSettings.mockImplementation(async () => undefined);
  mockGetConnectionForProfile.mockImplementation(async () => ({ id: CONNECTION_UUID }));
  mockResolveVisitDrift.mockImplementation(async () => ({ ok: true }));
});

// ─── UNAUTHORIZED ────────────────────────────────────────────────────────────

describe('unauthenticated calls', () => {
  it('disconnectCalendar returns UNAUTHORIZED when not signed in', async () => {
    mockState.adminRole = null;
    const result = await disconnectCalendar();
    expect(result.error?.code).toBe('UNAUTHORIZED');
    expect(mockDisconnectConnection).not.toHaveBeenCalled();
  });

  it('updateCalendarSettings returns UNAUTHORIZED when not signed in', async () => {
    mockState.adminRole = null;
    const result = await updateCalendarSettings({ freebusyEnabled: false });
    expect(result.error?.code).toBe('UNAUTHORIZED');
  });

  it('resolveCalendarDrift returns UNAUTHORIZED when not signed in', async () => {
    mockState.adminRole = null;
    const result = await resolveCalendarDrift({ visitId: VISIT_UUID, keep: 'propflow' });
    expect(result.error?.code).toBe('UNAUTHORIZED');
  });

  it('resyncCalendarNow returns UNAUTHORIZED when not signed in', async () => {
    mockState.adminRole = null;
    const result = await resyncCalendarNow();
    expect(result.error?.code).toBe('UNAUTHORIZED');
  });
});

// ─── disconnectCalendar: own profile only ───────────────────────────────────

describe('disconnectCalendar', () => {
  it('only affects the caller own profile (org + profile from ctx, never from input)', async () => {
    const result = await disconnectCalendar();
    expect(result.error).toBeUndefined();
    expect(mockDisconnectConnection).toHaveBeenCalledWith(ORG_UUID, PROFILE_UUID);
    expect(mockDisconnectConnection).toHaveBeenCalledTimes(1);
  });
});

// ─── updateCalendarSettings ──────────────────────────────────────────────────

describe('updateCalendarSettings', () => {
  it('forwards the parsed toggles for the caller own profile', async () => {
    const result = await updateCalendarSettings({ freebusyEnabled: false, writeEvents: true });
    expect(result.error).toBeUndefined();
    expect(mockUpdateConnectionSettings).toHaveBeenCalledWith(ORG_UUID, PROFILE_UUID, {
      freebusyEnabled: false,
      writeEvents: true,
    });
  });

  it('rejects a non-boolean field', async () => {
    const result = await updateCalendarSettings({ freebusyEnabled: 'yes' as unknown as boolean });
    expect(result.error?.code).toBe('VALIDATION_ERROR');
    expect(mockUpdateConnectionSettings).not.toHaveBeenCalled();
  });
});

// ─── resolveCalendarDrift: slot_taken -> CONFLICT ───────────────────────────

describe('resolveCalendarDrift', () => {
  it('maps slot_taken to CONFLICT', async () => {
    mockResolveVisitDrift.mockImplementation(async () => ({ ok: false, reason: 'slot_taken' }));
    const result = await resolveCalendarDrift({ visitId: VISIT_UUID, keep: 'google' });
    expect(result.error?.code).toBe('CONFLICT');
  });

  it('maps not_found to NOT_FOUND', async () => {
    mockResolveVisitDrift.mockImplementation(async () => ({ ok: false, reason: 'not_found' }));
    const result = await resolveCalendarDrift({ visitId: VISIT_UUID, keep: 'propflow' });
    expect(result.error?.code).toBe('NOT_FOUND');
  });

  it('passes the caller profile as actorProfileId, never from input', async () => {
    await resolveCalendarDrift({ visitId: VISIT_UUID, keep: 'propflow' });
    expect(mockResolveVisitDrift).toHaveBeenCalledWith({
      orgId: ORG_UUID,
      visitId: VISIT_UUID,
      keep: 'propflow',
      actorProfileId: PROFILE_UUID,
    });
  });

  it('rejects an invalid keep value', async () => {
    const result = await resolveCalendarDrift({ visitId: VISIT_UUID, keep: 'bogus' as unknown as 'propflow' });
    expect(result.error?.code).toBe('VALIDATION_ERROR');
    expect(mockResolveVisitDrift).not.toHaveBeenCalled();
  });
});

// ─── resyncCalendarNow ────────────────────────────────────────────────────────

describe('resyncCalendarNow', () => {
  it('enqueues calendar.sync for the caller own connection', async () => {
    const result = await resyncCalendarNow();
    expect(result.error).toBeUndefined();
    expect(mockGetConnectionForProfile).toHaveBeenCalledWith(ORG_UUID, PROFILE_UUID);
    expect(mockEnqueueJob).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: ORG_UUID, kind: 'calendar.sync', payload: { connectionId: CONNECTION_UUID } }),
    );
  });

  it('returns NOT_FOUND when there is no connection', async () => {
    mockGetConnectionForProfile.mockImplementation(async () => null);
    const result = await resyncCalendarNow();
    expect(result.error?.code).toBe('NOT_FOUND');
    expect(mockEnqueueJob).not.toHaveBeenCalled();
  });
});

// ─── RATE_LIMITED ────────────────────────────────────────────────────────────

describe('rate limiting', () => {
  it('returns RATE_LIMITED when the rate limiter rejects', async () => {
    mockState.rateLimitSuccess = false;
    const result = await disconnectCalendar();
    expect(result.error?.code).toBe('RATE_LIMITED');
  });
});
