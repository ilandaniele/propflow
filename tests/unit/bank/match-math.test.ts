import { describe, it, expect } from 'vitest';
import { suggestMatch, matchScore } from '@/lib/bank/match-math';

const line = { postedOn: '2026-03-05', description: 'TRANSF DE JUAN PEREZ', reference: 'OP-991', amount: '1200.00' };
const candidate = (id: string, extra: Partial<{ amount: string; paidAt: string; tenantName: string | null; reference: string | null }> = {}) => ({
  id, amount: '1200', paidAt: '2026-03-04', tenantName: null, reference: null, ...extra,
});

describe('bank match math', () => {
  it('scores reference and tenant name tokens', () => {
    expect(matchScore(line, candidate('a', { tenantName: 'Juan Pérez', reference: 'OP-991' }))).toBe(5);
    expect(matchScore(line, candidate('b', { tenantName: 'Ana Li' }))).toBe(0);
  });

  it('requires same amount within the date window', () => {
    expect(suggestMatch(line, [candidate('a', { amount: '1199.99' })])).toBeNull();
    expect(suggestMatch(line, [candidate('a', { paidAt: '2026-02-01' })])).toBeNull();
  });

  it('prefers higher score, then closer date', () => {
    const best = suggestMatch(line, [
      candidate('far', { paidAt: '2026-03-12' }),
      candidate('near', { paidAt: '2026-03-05' }),
      candidate('named', { paidAt: '2026-03-14', tenantName: 'Juan Perez' }),
    ]);
    expect(best?.id).toBe('named');
    expect(suggestMatch(line, [candidate('far', { paidAt: '2026-03-12' }), candidate('near', { paidAt: '2026-03-05' })])?.id).toBe('near');
  });
});
