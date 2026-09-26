/**
 * Unit tests for the visits dashboard Server Actions (item D).
 *
 * Covers (blueprint §6):
 * 1. Unauthenticated calls -> UNAUTHORIZED
 * 2. A target advisor profile from another org -> FORBIDDEN
 * 3. slot_taken from the service maps to CONFLICT
 * 4. Local wall-clock -> UTC conversion (Lima 10:00 -> 15:00Z)
 * 5. Overlapping weekly windows -> VALIDATION_ERROR
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const ORG_UUID = '550e8400-e29b-41d4-a716-446655440010';
const OTHER_PROFILE_UUID = '550e8400-e29b-41d4-a716-446655440011';
const LEAD_UUID = '550e8400-e29b-41d4-a716-446655440012';
const VISIT_UUID = '550e8400-e29b-41d4-a716-446655440013';
const PROFILE_UUID = '550e8400-e29b-41d4-a716-446655440014';

// ─── Shared mock state ──────────────────────────────────────────────────────

const mockState = {
  adminRole: 'admin' as 'admin' | 'tenant' | null,
  rateLimitSuccess: true,
  leadSelectRows: [{ id: LEAD_UUID, phone: '+51999999999' }] as Array<{ id: string; phone: string | null }>,
  profileSelectRows: [{ id: PROFILE_UUID }] as Array<{ id: string }>,
  bookVisitResult: { ok: true, visit: { id: VISIT_UUID } } as unknown,
};

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock('@/lib/auth/guards', () => ({
  requireAdmin: vi.fn().mockImplementation(async () => {
    if (mockState.adminRole !== 'admin') throw new Error('UNAUTHORIZED');
    return { userId: 'admin-uuid', orgId: ORG_UUID, role: 'admin', profile: {} };
  }),
}));

vi.mock('@/lib/ratelimit', () => ({
  mutationRateLimit: vi.fn().mockImplementation(() => ({ success: mockState.rateLimitSuccess })),
}));

vi.mock('@/lib/log', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), adminAction: vi.fn() },
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

vi.mock('@/lib/agent/config', () => ({
  getOrCreateAgentConfig: vi.fn().mockImplementation(async () => ({ timezone: 'America/Lima' })),
}));

const mockBookVisit = vi.fn();
const mockRescheduleVisit = vi.fn();
const mockCancelVisit = vi.fn();
const mockConfirmVisit = vi.fn();
const mockMarkVisitOutcome = vi.fn();
vi.mock('@/lib/agent/visits/service', () => ({
  bookVisit: (...args: unknown[]) => mockBookVisit(...args),
  rescheduleVisit: (...args: unknown[]) => mockRescheduleVisit(...args),
  cancelVisit: (...args: unknown[]) => mockCancelVisit(...args),
  confirmVisit: (...args: unknown[]) => mockConfirmVisit(...args),
  markVisitOutcome: (...args: unknown[]) => mockMarkVisitOutcome(...args),
}));

const insertedRows: Record<string, unknown>[] = [];
const deletedCalls: unknown[] = [];

vi.mock('@/lib/db', async () => {
  const schema = await vi.importActual<typeof import('@/lib/db/schema')>('@/lib/db/schema');

  const dbLike: Record<string, unknown> = {
    select: vi.fn(() => ({
      from: vi.fn((table: unknown) => ({
        where: vi.fn(() => ({
          limit: vi.fn(async () => (table === schema.crmLeads ? mockState.leadSelectRows : mockState.profileSelectRows)),
        })),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn((v: Record<string, unknown>) => {
        insertedRows.push(v);
        const chain = {
          returning: vi.fn(async () => [{ id: LEAD_UUID, phone: null }]),
          onConflictDoUpdate: vi.fn(async () => undefined),
        };
        return chain;
      }),
    })),
    delete: vi.fn(() => ({
      where: vi.fn(() => {
        deletedCalls.push(true);
        return { returning: vi.fn(async () => [{ id: 'exc-1' }]) };
      }),
    })),
  };
  dbLike.transaction = vi.fn(async (fn: (tx: unknown) => unknown) => fn(dbLike));

  return { db: dbLike };
});

import { createVisitManual, rescheduleVisitStaff } from '@/app/actions/visits';
import { replaceWeeklyWindows, saveAdvisorSettings } from '@/app/actions/visit-availability';

beforeEach(() => {
  vi.clearAllMocks();
  mockState.adminRole = 'admin';
  mockState.rateLimitSuccess = true;
  mockState.leadSelectRows = [{ id: LEAD_UUID, phone: '+51999999999' }];
  mockState.profileSelectRows = [{ id: PROFILE_UUID }];
  insertedRows.length = 0;
  deletedCalls.length = 0;

  mockBookVisit.mockImplementation(async () => ({ ok: true, visit: { id: VISIT_UUID } }));
  mockRescheduleVisit.mockImplementation(async () => ({ ok: true, visit: { id: VISIT_UUID } }));
  mockCancelVisit.mockImplementation(async () => ({ ok: true }));
  mockConfirmVisit.mockImplementation(async () => ({ id: VISIT_UUID }));
  mockMarkVisitOutcome.mockImplementation(async () => ({ id: VISIT_UUID }));
});

// ─── UNAUTHORIZED ────────────────────────────────────────────────────────────

describe('unauthenticated calls', () => {
  it('createVisitManual returns UNAUTHORIZED when not signed in', async () => {
    mockState.adminRole = null;
    const result = await createVisitManual({
      leadId: LEAD_UUID,
      profileId: PROFILE_UUID,
      date: '2026-10-01',
      startMinute: 600,
    });
    expect(result.error?.code).toBe('UNAUTHORIZED');
    expect(mockBookVisit).not.toHaveBeenCalled();
  });

  it('saveAdvisorSettings returns UNAUTHORIZED when not signed in', async () => {
    mockState.adminRole = null;
    const result = await saveAdvisorSettings({
      profileId: PROFILE_UUID,
      acceptsVisits: true,
      visitMinutes: 45,
      bufferMinutes: 15,
      minNoticeMinutes: 120,
      daysAhead: 14,
      slotStepMinutes: 30,
    });
    expect(result.error?.code).toBe('UNAUTHORIZED');
  });
});

// ─── FORBIDDEN (cross-org advisor profile) ─────────────────────────────────

describe('cross-org advisor profile', () => {
  it('saveAdvisorSettings returns FORBIDDEN when the profile is not an org admin', async () => {
    mockState.profileSelectRows = []; // assertAdvisorProfile finds nothing
    const result = await saveAdvisorSettings({
      profileId: OTHER_PROFILE_UUID,
      acceptsVisits: true,
      visitMinutes: 45,
      bufferMinutes: 15,
      minNoticeMinutes: 120,
      daysAhead: 14,
      slotStepMinutes: 30,
    });
    expect(result.error?.code).toBe('FORBIDDEN');
  });
});

// ─── slot_taken -> CONFLICT ──────────────────────────────────────────────────

describe('createVisitManual', () => {
  it('maps slot_taken to CONFLICT', async () => {
    mockBookVisit.mockImplementation(async () => ({ ok: false, reason: 'slot_taken' }));
    const result = await createVisitManual({
      leadId: LEAD_UUID,
      profileId: PROFILE_UUID,
      date: '2026-10-01',
      startMinute: 600,
    });
    expect(result.error?.code).toBe('CONFLICT');
  });

  it('converts Lima 10:00 local time to 15:00Z', async () => {
    await createVisitManual({
      leadId: LEAD_UUID,
      profileId: PROFILE_UUID,
      date: '2026-10-01',
      startMinute: 600, // 10:00
    });
    expect(mockBookVisit).toHaveBeenCalledWith(
      expect.objectContaining({ startsAt: new Date('2026-10-01T15:00:00.000Z') }),
    );
  });

  it('rejects when both leadId and newLead are provided', async () => {
    const result = await createVisitManual({
      leadId: LEAD_UUID,
      newLead: { fullName: 'Juan' },
      profileId: PROFILE_UUID,
      date: '2026-10-01',
      startMinute: 600,
    });
    expect(result.error?.code).toBe('VALIDATION_ERROR');
    expect(mockBookVisit).not.toHaveBeenCalled();
  });

  it('inserts a fresh lead directly when newLead is provided', async () => {
    await createVisitManual({
      newLead: { fullName: 'Prospecto Nuevo', phone: '+51988888888' },
      profileId: PROFILE_UUID,
      date: '2026-10-01',
      startMinute: 600,
    });
    expect(insertedRows[0]).toMatchObject({ fullName: 'Prospecto Nuevo', sourceChannel: 'manual' });
    expect(mockBookVisit).toHaveBeenCalledWith(expect.objectContaining({ leadId: LEAD_UUID }));
  });
});

describe('rescheduleVisitStaff', () => {
  it('maps not_found to NOT_FOUND', async () => {
    mockRescheduleVisit.mockImplementation(async () => ({ ok: false, reason: 'not_found' }));
    const result = await rescheduleVisitStaff({ visitId: VISIT_UUID, date: '2026-10-01', startMinute: 600 });
    expect(result.error?.code).toBe('NOT_FOUND');
  });

  it('does not filter by leadId (staff path)', async () => {
    await rescheduleVisitStaff({ visitId: VISIT_UUID, date: '2026-10-01', startMinute: 600 });
    expect(mockRescheduleVisit).toHaveBeenCalledWith(expect.objectContaining({ leadId: null }));
  });
});

// ─── Overlapping weekly windows -> VALIDATION_ERROR ─────────────────────────

describe('replaceWeeklyWindows', () => {
  it('rejects overlapping windows on the same weekday', async () => {
    const result = await replaceWeeklyWindows({
      profileId: PROFILE_UUID,
      windows: [
        { weekday: 1, startMinute: 540, endMinute: 720 }, // 09:00-12:00
        { weekday: 1, startMinute: 660, endMinute: 780 }, // 11:00-13:00 overlaps
      ],
    });
    expect(result.error?.code).toBe('VALIDATION_ERROR');
  });

  it('accepts back-to-back non-overlapping windows', async () => {
    const result = await replaceWeeklyWindows({
      profileId: PROFILE_UUID,
      windows: [
        { weekday: 1, startMinute: 540, endMinute: 720 },
        { weekday: 1, startMinute: 720, endMinute: 900 },
      ],
    });
    expect(result.error).toBeUndefined();
  });
});
