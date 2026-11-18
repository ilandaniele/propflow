/**
 * Unit tests for src/lib/db/retry.ts — single retry on transient D1 errors only.
 */
import { describe, it, expect, vi } from 'vitest';
import { withDbRetry, withFastDbRetry } from '@/lib/db/retry';

vi.mock('@/lib/log', () => ({ log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

describe.each([
  ['withDbRetry', withDbRetry],
  ['withFastDbRetry', withFastDbRetry],
])('%s', (_name, retry) => {
  it('returns on first success without retrying', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    expect(await retry(fn, 'test')).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries once after a transient D1 error', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('D1_ERROR: Network connection lost.'))
      .mockResolvedValueOnce('recovered');
    expect(await retry(fn, 'test')).toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('throws after the single retry also fails', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('D1_ERROR: Network connection lost.'));
    await expect(retry(fn, 'test')).rejects.toThrow('Network connection lost');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('does not retry non-transient errors', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('D1_ERROR: UNIQUE constraint failed: users.email'));
    await expect(retry(fn, 'test')).rejects.toThrow('UNIQUE constraint failed');
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
