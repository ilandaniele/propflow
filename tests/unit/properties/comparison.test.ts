import { describe, it, expect } from 'vitest';
import { parseComparedIds, windowStart } from '@/lib/properties/comparison';

const ids = Array.from({ length: 6 }, (_, i) => `0000000${i}-0000-4000-8000-000000000000`);

describe('parseComparedIds', () => {
  it('accepts one or many guids, dedupes and caps at 4', () => {
    expect(parseComparedIds(undefined)).toEqual([]);
    expect(parseComparedIds(ids[0])).toEqual([ids[0]]);
    expect(parseComparedIds([ids[0], ids[0], ids[1]])).toEqual([ids[0], ids[1]]);
    expect(parseComparedIds(ids)).toEqual(ids.slice(0, 4));
  });

  it('drops non-guid values', () => {
    expect(parseComparedIds(['x', "1' OR 1=1", ids[2]])).toEqual([ids[2]]);
  });
});

describe('windowStart', () => {
  it('starts on the first day of the month, 12 months including current', () => {
    expect(windowStart('2026-11-23')).toBe('2025-12-01');
    expect(windowStart('2026-01-05', 1)).toBe('2026-01-01');
  });
});
