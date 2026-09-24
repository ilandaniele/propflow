import { describe, it, expect, vi, beforeEach } from 'vitest';

const dueRows = [
  { id: 'job-1', orgId: 'org-1', kind: 'noop', payload: { foo: 'bar' }, attempts: 0 },
];

// vi.mock factories are hoisted above regular declarations, so any mock fns
// they close over must be created via vi.hoisted() to avoid a TDZ error.
const { selectForUpdate, txUpdate, insertReturning, rootUpdate } = vi.hoisted(() => ({
  selectForUpdate: vi.fn(async () => [] as unknown[]),
  txUpdate: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(async () => []) })) })),
  insertReturning: vi.fn(async () => [{ id: 'job-new' }]),
  rootUpdate: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(async () => []) })) })),
}));

vi.mock('@/lib/db', () => ({
  db: {
    insert: vi.fn(() => ({ values: vi.fn(() => ({ returning: insertReturning })) })),
    update: rootUpdate,
    transaction: vi.fn(async (cb: (tx: unknown) => unknown) => {
      const tx = {
        select: vi.fn(() => ({
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          orderBy: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          for: selectForUpdate,
        })),
        update: txUpdate,
      };
      return cb(tx);
    }),
  },
}));

vi.mock('@/lib/log', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { enqueueJob, drainAgentJobs, registerAgentJobHandler } from '@/lib/agent/jobs';

describe('agent/jobs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectForUpdate.mockResolvedValue(dueRows);
  });

  it('enqueueJob inserts a row and returns its id', async () => {
    const id = await enqueueJob({ orgId: 'org-1', kind: 'reminder', payload: { visitId: 'v1' } });
    expect(id).toBe('job-new');
  });

  it('drainAgentJobs runs the registered handler and reports it processed', async () => {
    const handler = vi.fn(async () => {});
    registerAgentJobHandler('noop', handler);

    const result = await drainAgentJobs(10);

    expect(handler).toHaveBeenCalledWith({ foo: 'bar' }, 'org-1');
    expect(result).toEqual({ processed: 1, failed: 0 });
  });

  it('drainAgentJobs marks a job for retry when no handler is registered', async () => {
    selectForUpdate.mockResolvedValueOnce([
      { id: 'job-2', orgId: 'org-1', kind: 'unregistered-kind', payload: {}, attempts: 0 },
    ]);

    const result = await drainAgentJobs(10);

    expect(result.failed).toBe(1);
    expect(rootUpdate).toHaveBeenCalled();
  });

  it('returns zero when there is nothing due', async () => {
    selectForUpdate.mockResolvedValueOnce([]);
    const result = await drainAgentJobs(10);
    expect(result).toEqual({ processed: 0, failed: 0 });
  });
});
