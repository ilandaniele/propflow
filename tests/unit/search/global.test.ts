import { describe, it, expect } from 'vitest';
import { groupHits, hitHref, likePattern, normalizeQuery } from '@/lib/search/global';

describe('normalizeQuery', () => {
  it('trims, collapses spaces and enforces length bounds', () => {
    expect(normalizeQuery('  Juan   Pérez ')).toBe('Juan Pérez');
    expect(normalizeQuery('a')).toBeNull();
    expect(normalizeQuery(undefined)).toBeNull();
    expect(normalizeQuery('x'.repeat(81))).toBeNull();
  });
});

describe('likePattern', () => {
  it('lowercases and escapes LIKE wildcards', () => {
    expect(likePattern('Ab')).toBe('%ab%');
    expect(likePattern('50%_a!b')).toBe('%50!%!_a!!b%');
  });
});

describe('hitHref', () => {
  it('maps each kind to its dashboard page', () => {
    expect(hitHref({ kind: 'tenant', id: 't1' })).toBe('/dashboard/tenants/t1');
    expect(hitHref({ kind: 'unit', id: 'u1' })).toBe('/dashboard/units/u1');
    expect(hitHref({ kind: 'incident', id: 'i1' })).toBe('/dashboard/incidents/i1');
    expect(hitHref({ kind: 'lead', id: 'l1' })).toBe('/dashboard/leads/l1');
    expect(hitHref({ kind: 'property', id: 'p1' })).toBe('/dashboard/properties');
  });
});

describe('groupHits', () => {
  it('groups in a fixed kind order and drops empty kinds', () => {
    const groups = groupHits([
      { kind: 'lead', id: '1', title: 'L', subtitle: null },
      { kind: 'tenant', id: '2', title: 'T', subtitle: null },
    ]);
    expect(groups.map((g) => g.kind)).toEqual(['tenant', 'lead']);
  });
});
