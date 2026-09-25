/**
 * Unit tests for the /dashboard/leads Server Actions (item F, blueprint §7).
 *
 * Covers:
 * 1. Unauthenticated calls -> UNAUTHORIZED
 * 2. A lead of another org -> NOT_FOUND
 * 3. Moving to a stage of the other pipeline -> VALIDATION_ERROR
 * 4. Moving to a won stage calls stopFollowups('stage_closed')
 * 5. Deleting a system stage -> FORBIDDEN
 * 6. reorderStages with a foreign id -> VALIDATION_ERROR
 * 7. A routing member that is not an org admin -> FORBIDDEN (lead-routing.ts)
 *
 * src/lib/leads/{routing,followups}.ts (items D/E) are mocked wholesale —
 * this file only exercises leads-pipeline.ts / lead-routing.ts.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const ORG_UUID = '650e8400-e29b-41d4-a716-446655440010';
const LEAD_UUID = '650e8400-e29b-41d4-a716-446655440012';
const STAGE_UUID = '650e8400-e29b-41d4-a716-446655440013';
const OTHER_STAGE_UUID = '650e8400-e29b-41d4-a716-446655440014';
const FOREIGN_STAGE_UUID = '650e8400-e29b-41d4-a716-446655440099';
const PROFILE_UUID = '650e8400-e29b-41d4-a716-446655440015';

// ─── Shared mock state ──────────────────────────────────────────────────────

const mockState = {
  adminRole: 'admin' as 'admin' | 'tenant' | null,
  rateLimitSuccess: true,
  leadRows: [{ id: LEAD_UUID, pipeline: 'demand', assignedProfileId: null }] as Array<Record<string, unknown>>,
  stageRows: [{ id: STAGE_UUID, orgId: ORG_UUID, pipeline: 'demand', key: 'new', label: 'Nuevo', isSystem: false, kind: 'open', archived: false }] as Array<Record<string, unknown>>,
};

const insertedRows: Array<{ table: unknown; values: unknown }> = [];
const updatedCalls: Array<{ table: unknown; values: unknown }> = [];
const deletedCalls: Array<{ table: unknown }> = [];

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
  getOrCreateAgentConfig: vi.fn().mockImplementation(async () => ({ orgId: ORG_UUID, routingMode: 'round_robin', followupPolicy: {} })),
}));

const mockGetStage = vi.fn();
const mockGetPipelineStages = vi.fn();
vi.mock('@/lib/leads/stages', () => ({
  getStage: (...args: unknown[]) => mockGetStage(...args),
  getPipelineStages: (...args: unknown[]) => mockGetPipelineStages(...args),
  slugifyStageKey: (label: string) => label.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 40) || 's_stage',
}));

const mockAssignLeadManually = vi.fn();
const mockRouteLead = vi.fn();
const mockUpsertRoutingMember = vi.fn();
const mockRemoveRoutingMember = vi.fn();
vi.mock('@/lib/leads/routing', () => ({
  assignLeadManually: (...args: unknown[]) => mockAssignLeadManually(...args),
  routeLead: (...args: unknown[]) => mockRouteLead(...args),
  upsertRoutingMember: (...args: unknown[]) => mockUpsertRoutingMember(...args),
  removeRoutingMember: (...args: unknown[]) => mockRemoveRoutingMember(...args),
}));

const mockStopFollowups = vi.fn();
vi.mock('@/lib/leads/followups', () => ({
  stopFollowups: (...args: unknown[]) => mockStopFollowups(...args),
}));

vi.mock('@/lib/db', async () => {
  const schema = await vi.importActual<typeof import('@/lib/db/schema')>('@/lib/db/schema');

  const dbLike: Record<string, unknown> = {
    select: vi.fn(() => ({
      from: vi.fn((table: unknown) => ({
        where: vi.fn(() => ({
          limit: vi.fn(async () => (table === schema.crmLeads ? mockState.leadRows : mockState.stageRows)),
        })),
      })),
    })),
    update: vi.fn((table: unknown) => ({
      set: vi.fn((values: unknown) => ({
        where: vi.fn(async () => { updatedCalls.push({ table, values }); return undefined; }),
      })),
    })),
    insert: vi.fn((table: unknown) => ({
      values: vi.fn(async (values: unknown) => { insertedRows.push({ table, values }); return undefined; }),
    })),
    delete: vi.fn((table: unknown) => ({
      where: vi.fn(async () => { deletedCalls.push({ table }); return undefined; }),
    })),
  };
  dbLike.transaction = vi.fn(async (fn: (tx: unknown) => unknown) => fn(dbLike));

  return { db: dbLike };
});

import { deleteStage, moveLeadStage, reorderStages } from '@/app/actions/leads-pipeline';
import { upsertRoutingMemberAction } from '@/app/actions/lead-routing';

beforeEach(() => {
  vi.clearAllMocks();
  mockState.adminRole = 'admin';
  mockState.rateLimitSuccess = true;
  mockState.leadRows = [{ id: LEAD_UUID, pipeline: 'demand', assignedProfileId: null }];
  mockState.stageRows = [{ id: STAGE_UUID, orgId: ORG_UUID, pipeline: 'demand', key: 'new', label: 'Nuevo', isSystem: false, kind: 'open', archived: false }];
  insertedRows.length = 0;
  updatedCalls.length = 0;
  deletedCalls.length = 0;

  mockGetStage.mockImplementation(async () => ({
    id: STAGE_UUID, orgId: ORG_UUID, pipeline: 'demand', key: 'contacted', label: 'Contactado', position: 1, kind: 'open', color: null, isSystem: true, archived: false,
  }));
  mockGetPipelineStages.mockImplementation(async () => [
    { id: STAGE_UUID, orgId: ORG_UUID, pipeline: 'demand', key: 'new', label: 'Nuevo', position: 0, kind: 'open', color: null, isSystem: true, archived: false },
    { id: OTHER_STAGE_UUID, orgId: ORG_UUID, pipeline: 'demand', key: 'contacted', label: 'Contactado', position: 1, kind: 'open', color: null, isSystem: true, archived: false },
  ]);
  mockAssignLeadManually.mockImplementation(async () => ({ ok: true }));
  mockRouteLead.mockImplementation(async () => ({ profileId: null, method: null }));
  mockUpsertRoutingMember.mockImplementation(async () => undefined);
  mockRemoveRoutingMember.mockImplementation(async () => undefined);
  mockStopFollowups.mockImplementation(async () => 0);
});

// ─── UNAUTHORIZED ────────────────────────────────────────────────────────────

describe('unauthenticated calls', () => {
  it('moveLeadStage returns UNAUTHORIZED when not signed in', async () => {
    mockState.adminRole = null;
    const result = await moveLeadStage({ leadId: LEAD_UUID, stage: 'contacted' });
    expect(result.error?.code).toBe('UNAUTHORIZED');
    expect(mockGetStage).not.toHaveBeenCalled();
  });
});

// ─── NOT_FOUND (foreign lead) ────────────────────────────────────────────────

describe('moveLeadStage — cross-org lead', () => {
  it('returns NOT_FOUND for a lead outside the caller org', async () => {
    mockState.leadRows = [];
    const result = await moveLeadStage({ leadId: LEAD_UUID, stage: 'contacted' });
    expect(result.error?.code).toBe('NOT_FOUND');
  });
});

// ─── VALIDATION_ERROR (other pipeline / unknown stage) ──────────────────────

describe('moveLeadStage — invalid target stage', () => {
  it('returns VALIDATION_ERROR when the stage does not exist for this pipeline', async () => {
    mockGetStage.mockImplementation(async () => null);
    const result = await moveLeadStage({ leadId: LEAD_UUID, stage: 'contacted' });
    expect(result.error?.code).toBe('VALIDATION_ERROR');
  });
});

// ─── won stage -> stopFollowups ─────────────────────────────────────────────

describe('moveLeadStage — won stage', () => {
  it('calls stopFollowups with stage_closed', async () => {
    mockGetStage.mockImplementation(async () => ({
      id: STAGE_UUID, orgId: ORG_UUID, pipeline: 'demand', key: 'won', label: 'Cerrado', position: 5, kind: 'won', color: null, isSystem: true, archived: false,
    }));
    const result = await moveLeadStage({ leadId: LEAD_UUID, stage: 'won' });
    expect(result.error).toBeUndefined();
    expect(mockStopFollowups).toHaveBeenCalledWith(ORG_UUID, LEAD_UUID, 'stage_closed');
  });
});

// ─── deleteStage — system stage -> FORBIDDEN ────────────────────────────────

describe('deleteStage', () => {
  it('returns FORBIDDEN for a system stage', async () => {
    mockState.stageRows = [{ id: STAGE_UUID, orgId: ORG_UUID, pipeline: 'demand', key: 'new', label: 'Nuevo', isSystem: true, kind: 'open', archived: false }];
    const result = await deleteStage({ id: STAGE_UUID, moveLeadsTo: 'contacted' });
    expect(result.error?.code).toBe('FORBIDDEN');
    expect(deletedCalls).toHaveLength(0);
  });
});

// ─── reorderStages — foreign id -> VALIDATION_ERROR ─────────────────────────

describe('reorderStages', () => {
  it('rejects an orderedIds list containing a foreign stage id', async () => {
    const result = await reorderStages({ pipeline: 'demand', orderedIds: [STAGE_UUID, FOREIGN_STAGE_UUID] });
    expect(result.error?.code).toBe('VALIDATION_ERROR');
  });

  it('accepts the exact id set of the pipeline', async () => {
    const result = await reorderStages({ pipeline: 'demand', orderedIds: [OTHER_STAGE_UUID, STAGE_UUID] });
    expect(result.error).toBeUndefined();
  });
});

// ─── upsertRoutingMemberAction — non-admin profile -> FORBIDDEN ─────────────

describe('upsertRoutingMemberAction', () => {
  it('returns FORBIDDEN when the target profile is not an org admin', async () => {
    mockUpsertRoutingMember.mockImplementation(async () => { throw new Error('profile is not an org admin'); });
    const result = await upsertRoutingMemberAction({ profileId: PROFILE_UUID, pipeline: 'both', weight: 1, active: true, maxOpenLeads: null });
    expect(result.error?.code).toBe('FORBIDDEN');
  });

  it('succeeds for a valid admin profile', async () => {
    const result = await upsertRoutingMemberAction({ profileId: PROFILE_UUID, pipeline: 'both', weight: 1, active: true, maxOpenLeads: null });
    expect(result.error).toBeUndefined();
  });
});
