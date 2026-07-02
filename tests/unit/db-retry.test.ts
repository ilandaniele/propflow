/**
 * Unit tests for src/lib/db/retry.ts — withDbRetry (Fly resume / stale-connection retry).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { withDbRetry } from '@/lib/db/retry';

vi.mock('@/lib/log', () => ({ log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

describe('withDbRetry', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('returns immediately on first success (no retry)', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const p = withDbRetry(fn, 'test');
    await vi.runAllTimersAsync();
    expect(await p).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries after a transient failure and then succeeds', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('Failed query: stale connection'))
      .mockResolvedValueOnce('recovered');
    const p = withDbRetry(fn, 'test');
    await vi.runAllTimersAsync();
    expect(await p).toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('throws the last error after 3 failed attempts', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('no active leader found'));
    const p = withDbRetry(fn, 'test');
    const assertion = expect(p).rejects.toThrow('no active leader found');
    await vi.runAllTimersAsync();
    await assertion;
    expect(fn).toHaveBeenCalledTimes(3);
  });
});
