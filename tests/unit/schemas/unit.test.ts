/**
 * Unit tests for CreateUnitSchema and UpdateUnitSchema (src/lib/schemas/property.ts).
 * Focuses on toilet_type field wiring — validates all three allowed values and
 * rejects unknown values with a Zod parse failure (VALIDATION_ERROR code convention).
 */

import { describe, it, expect } from 'vitest';
import { CreateUnitSchema, UpdateUnitSchema } from '@/lib/schemas/property';

const VALID_BASE = {
  property_id: '00000000-0000-0000-0000-000000000001',
  label:       'Apt 3B',
};

describe('CreateUnitSchema — toilet_type field', () => {
  it('accepts toilet_type="private"', () => {
    const result = CreateUnitSchema.safeParse({ ...VALID_BASE, toilet_type: 'private' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.toilet_type).toBe('private');
  });

  it('accepts toilet_type="shared"', () => {
    const result = CreateUnitSchema.safeParse({ ...VALID_BASE, toilet_type: 'shared' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.toilet_type).toBe('shared');
  });

  it('accepts toilet_type="none"', () => {
    const result = CreateUnitSchema.safeParse({ ...VALID_BASE, toilet_type: 'none' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.toilet_type).toBe('none');
  });

  it('defaults toilet_type to "private" when omitted', () => {
    const result = CreateUnitSchema.safeParse(VALID_BASE);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.toilet_type).toBe('private');
  });

  it('rejects toilet_type="garden_hose" (VALIDATION_ERROR)', () => {
    const result = CreateUnitSchema.safeParse({ ...VALID_BASE, toilet_type: 'garden_hose' });
    expect(result.success).toBe(false);
    if (!result.success) {
      const fields = result.error.flatten().fieldErrors;
      expect(fields.toilet_type).toBeDefined();
    }
  });

  it('rejects toilet_type="private_toilet" (long form from old spec — wrong value)', () => {
    const result = CreateUnitSchema.safeParse({ ...VALID_BASE, toilet_type: 'private_toilet' });
    expect(result.success).toBe(false);
  });

  it('rejects toilet_type="shared_toilet" (long form from old spec — wrong value)', () => {
    const result = CreateUnitSchema.safeParse({ ...VALID_BASE, toilet_type: 'shared_toilet' });
    expect(result.success).toBe(false);
  });

  it('rejects empty string for toilet_type', () => {
    const result = CreateUnitSchema.safeParse({ ...VALID_BASE, toilet_type: '' });
    expect(result.success).toBe(false);
  });
});

describe('UpdateUnitSchema — toilet_type field', () => {
  const VALID_UPDATE = {
    id:    '00000000-0000-0000-0000-000000000099',
    label: 'Apt 4C',
  };

  it('accepts toilet_type update to "shared"', () => {
    const result = UpdateUnitSchema.safeParse({ ...VALID_UPDATE, toilet_type: 'shared' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.toilet_type).toBe('shared');
  });

  it('rejects toilet_type="invalid_value" on update', () => {
    const result = UpdateUnitSchema.safeParse({ ...VALID_UPDATE, toilet_type: 'invalid_value' });
    expect(result.success).toBe(false);
  });

  it('allows toilet_type to be omitted (partial update)', () => {
    const result = UpdateUnitSchema.safeParse(VALID_UPDATE);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.toilet_type).toBeUndefined();
  });
});
