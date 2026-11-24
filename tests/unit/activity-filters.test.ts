import { describe, it, expect } from 'vitest';
import { resolveActivityRange } from '@/lib/activity/filters';

describe('resolveActivityRange', () => {
  it('returns an open range without params', () => {
    expect(resolveActivityRange({})).toEqual({ from: undefined, to: undefined });
  });

  it('starts at from midnight UTC and ends after the whole to day', () => {
    const range = resolveActivityRange({ from: '2026-11-01', to: '2026-11-30' });
    expect(range.from?.toISOString()).toBe('2026-11-01T00:00:00.000Z');
    expect(range.to?.toISOString()).toBe('2026-12-01T00:00:00.000Z');
  });

  it('ignores malformed dates', () => {
    expect(resolveActivityRange({ from: 'yesterday', to: '2026-13-45' })).toEqual({ from: undefined, to: undefined });
  });
});
