/**
 * tests/unit/tenant-registration-schema.test.ts
 *
 * Tests for the Zod schema in src/lib/schemas/tenantRegistration.ts
 */

import { describe, it, expect } from 'vitest';
import { tenantRegistrationSchema } from '@/lib/schemas/tenantRegistration';

const VALID_INPUT = {
  first_name:               'María',
  last_name:                'García',
  email:                    'Test@Example.COM',
  phone:                    '999888777',
  dni:                      '12345678',
  birth_date:               '1990-05-15',
  terms_accepted:           true as const,
  privacy_accepted:         true as const,
};

describe('tenantRegistrationSchema — valid input', () => {
  it('passes validation with all mandatory fields', () => {
    const result = tenantRegistrationSchema.safeParse(VALID_INPUT);
    expect(result.success).toBe(true);
  });

  it('normalizes email: lowercases mixed-case email', () => {
    const result = tenantRegistrationSchema.safeParse(VALID_INPUT);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.email).toBe('test@example.com');
    }
  });

  it('passes without emergency contact fields (they are optional)', () => {
    const input = { ...VALID_INPUT };
    // emergency_contact_name and emergency_contact_phone are not provided
    const result = tenantRegistrationSchema.safeParse(input);
    expect(result.success).toBe(true);
  });

  it('passes with emergency contact fields provided', () => {
    const input = {
      ...VALID_INPUT,
      emergency_contact_name:  'Juan García',
      emergency_contact_phone: '987654321',
    };
    const result = tenantRegistrationSchema.safeParse(input);
    expect(result.success).toBe(true);
  });
});

describe('tenantRegistrationSchema — missing mandatory fields', () => {
  function omit<T extends object, K extends keyof T>(obj: T, key: K): Omit<T, K> {
    const copy = { ...obj };
    delete copy[key];
    return copy;
  }

  it('fails when first_name is missing', () => {
    const result = tenantRegistrationSchema.safeParse(omit(VALID_INPUT, 'first_name'));
    expect(result.success).toBe(false);
  });

  it('fails when last_name is missing', () => {
    const result = tenantRegistrationSchema.safeParse(omit(VALID_INPUT, 'last_name'));
    expect(result.success).toBe(false);
  });

  it('fails when email is missing', () => {
    const result = tenantRegistrationSchema.safeParse(omit(VALID_INPUT, 'email'));
    expect(result.success).toBe(false);
  });

  it('fails when phone is missing', () => {
    const result = tenantRegistrationSchema.safeParse(omit(VALID_INPUT, 'phone'));
    expect(result.success).toBe(false);
  });

  it('fails when dni is missing', () => {
    const result = tenantRegistrationSchema.safeParse(omit(VALID_INPUT, 'dni'));
    expect(result.success).toBe(false);
  });

  it('fails when birth_date is missing', () => {
    const result = tenantRegistrationSchema.safeParse(omit(VALID_INPUT, 'birth_date'));
    expect(result.success).toBe(false);
  });
});

describe('tenantRegistrationSchema — terms/privacy acceptance', () => {
  it('fails when terms_accepted is false', () => {
    const result = tenantRegistrationSchema.safeParse({ ...VALID_INPUT, terms_accepted: false });
    expect(result.success).toBe(false);
  });

  it('fails when privacy_accepted is false', () => {
    const result = tenantRegistrationSchema.safeParse({ ...VALID_INPUT, privacy_accepted: false });
    expect(result.success).toBe(false);
  });
});

describe('tenantRegistrationSchema — birth_date format', () => {
  it('fails with date in DD/MM/YYYY format', () => {
    const result = tenantRegistrationSchema.safeParse({ ...VALID_INPUT, birth_date: '15/05/1990' });
    expect(result.success).toBe(false);
  });

  it('fails with date in MM-DD-YYYY format', () => {
    const result = tenantRegistrationSchema.safeParse({ ...VALID_INPUT, birth_date: '05-15-1990' });
    expect(result.success).toBe(false);
  });

  it('fails with plain text', () => {
    const result = tenantRegistrationSchema.safeParse({ ...VALID_INPUT, birth_date: 'not-a-date' });
    expect(result.success).toBe(false);
  });

  it('passes with valid YYYY-MM-DD format', () => {
    const result = tenantRegistrationSchema.safeParse({ ...VALID_INPUT, birth_date: '2000-01-01' });
    expect(result.success).toBe(true);
  });
});
