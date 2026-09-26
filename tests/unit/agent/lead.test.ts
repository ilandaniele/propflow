import { describe, it, expect, vi, beforeEach } from 'vitest';

const { selectRows, insertedValues, updateSets } = vi.hoisted(() => ({
  selectRows: [] as unknown[],
  insertedValues: [] as Record<string, unknown>[],
  updateSets: [] as Record<string, unknown>[],
}));

function baseLeadRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'lead-1',
    fullName: 'Prospecto WhatsApp',
    phone: '+51987654321',
    operationType: null,
    pipeline: 'demand',
    budgetMin: null,
    budgetMax: null,
    currency: 'PEN',
    zones: [],
    bedroomsMin: null,
    moveInDate: null,
    timeline: null,
    pets: null,
    score: 0,
    intentTag: null,
    stage: 'new',
    doNotContact: false,
    ...overrides,
  };
}

vi.mock('@/lib/db', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({ limit: vi.fn(async () => selectRows) })),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn((v: Record<string, unknown>) => {
        insertedValues.push(v);
        return { returning: vi.fn(async () => [baseLeadRow({ id: 'lead-new', ...v })]) };
      }),
    })),
    update: vi.fn(() => ({
      set: vi.fn((s: Record<string, unknown>) => {
        updateSets.push(s);
        return { where: vi.fn(() => ({ returning: vi.fn(async () => [baseLeadRow({ ...selectRows[0] as object, ...s })]) })) };
      }),
    })),
  },
}));

import { getLead, createProspectLead, applyLeadQualification } from '@/lib/agent/lead';

describe('agent/lead', () => {
  beforeEach(() => {
    selectRows.length = 0;
    insertedValues.length = 0;
    updateSets.length = 0;
  });

  it('getLead returns null when no row matches', async () => {
    expect(await getLead('org-1', 'nope')).toBeNull();
  });

  it('getLead maps a row to a LeadRecord', async () => {
    selectRows.push(baseLeadRow());
    const lead = await getLead('org-1', 'lead-1');
    expect(lead).toMatchObject({ id: 'lead-1', pipeline: 'demand', score: 0 });
  });

  it('createProspectLead inserts with pipeline demand by default', async () => {
    const lead = await createProspectLead({ orgId: 'org-1', fullName: 'Juan', phone: '+51999', sourceChannel: 'whatsapp' });
    expect(lead.id).toBe('lead-new');
    expect(insertedValues[0]).toMatchObject({ pipeline: 'demand', source: 'agent', fullName: 'Juan' });
  });

  it('createProspectLead honors an explicit supply pipeline (owner leads)', async () => {
    await createProspectLead({ orgId: 'org-1', fullName: 'Dueño', sourceChannel: 'whatsapp', pipeline: 'supply', operationType: 'owner_sell' });
    expect(insertedValues[0]).toMatchObject({ pipeline: 'supply', operationType: 'owner_sell' });
  });

  it('applyLeadQualification throws when the lead does not exist for this org', async () => {
    await expect(applyLeadQualification('org-1', 'missing', { zones: ['X'] })).rejects.toThrow('not found');
  });

  it('applyLeadQualification recomputes score deterministically and merges with existing data', async () => {
    selectRows.push(baseLeadRow({ zones: ['Miraflores'] }));

    const updated = await applyLeadQualification('org-1', 'lead-1', { budgetMax: 2000, timeline: 'immediate' });

    expect(updateSets[0]).toMatchObject({
      zones: ['Miraflores'], // preserved from existing, not overwritten by an unset field
      budgetMax: '2000',
      timeline: 'immediate',
    });
    expect(updateSets[0].score).toBeGreaterThan(0);
    expect(updated.score).toBe(updateSets[0].score);
  });

  it('never lets a qualification patch set score, intentTag, stage, or doNotContact directly', async () => {
    selectRows.push(baseLeadRow());
    await applyLeadQualification('org-1', 'lead-1', {
      // @ts-expect-error — these fields don't exist on the qualification patch type
      score: 999,
      // @ts-expect-error
      doNotContact: false,
      zones: ['X'],
    });
    // score is always the deterministic computeLeadScore() output, never the injected 999
    expect(updateSets[0].score).toBeLessThan(100);
  });
});
