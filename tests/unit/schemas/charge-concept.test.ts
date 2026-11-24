import { describe, it, expect } from 'vitest';
import { SaveChargeConceptSchema } from '@/lib/schemas/charge-concept';

describe('SaveChargeConceptSchema', () => {
  it('turns empty optional fields into null', () => {
    expect(SaveChargeConceptSchema.parse({ id: '', description: ' Agua ', code: '', base_amount: '' }))
      .toEqual({ id: null, description: 'Agua', code: null, base_amount: null });
  });

  it('coerces the default amount to a number', () => {
    expect(SaveChargeConceptSchema.parse({ description: 'Cochera', base_amount: '120.50' }).base_amount).toBe(120.5);
  });

  it('rejects an empty description', () => {
    expect(SaveChargeConceptSchema.safeParse({ description: '   ' }).success).toBe(false);
  });

  it('rejects a negative amount', () => {
    expect(SaveChargeConceptSchema.safeParse({ description: 'Agua', base_amount: '-1' }).success).toBe(false);
  });

  it('rejects a malformed id', () => {
    expect(SaveChargeConceptSchema.safeParse({ id: 'nope', description: 'Agua' }).success).toBe(false);
  });
});
