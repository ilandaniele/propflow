/**
 * Unit test for src/lib/ai/budget.ts refundBudget — a failed AI call must return
 * the pre-allocated token estimate so the org's daily budget isn't leaked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const state = vi.hoisted(() => ({ tokensUsed: 1000, updated: undefined as number | undefined }));

vi.mock('@/lib/log', () => ({ log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/db', () => {
  const whereSelect = vi.fn(() => ({ limit: vi.fn(async () => [{ tokensUsed: state.tokensUsed }]) }));
  return {
    db: {
      select: vi.fn(() => ({ from: vi.fn(() => ({ where: whereSelect })) })),
      update: vi.fn(() => ({
        set: vi.fn((vals: { tokensUsed: number }) => {
          state.updated = vals.tokensUsed;
          return { where: vi.fn(async () => {}) };
        }),
      })),
    },
  };
});

import { refundBudget } from '@/lib/ai/budget';

describe('refundBudget', () => {
  beforeEach(() => { state.tokensUsed = 1000; state.updated = undefined; });

  it('subtracts the estimated tokens from today\'s counter', async () => {
    await refundBudget('org-1', 1000);
    expect(state.updated).toBe(0); // 1000 - 1000
  });

  it('never drives the counter below zero', async () => {
    state.tokensUsed = 300;
    await refundBudget('org-1', 1000);
    expect(state.updated).toBe(0); // max(0, 300 - 1000)
  });
});
