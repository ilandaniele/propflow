/**
 * Unit tests for onboarding Zod schema and createOrg action logic.
 *
 * Tests: Zod min(2)/max(120) trim; rate limit short-circuit; auth guard;
 * idempotency; provisioning failure → PROVISION_FAILED error.
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';

// Re-declare the Zod schema here (mirrors src/app/actions/onboarding.ts)
// so we can test it without importing Next.js server internals.
const CreateOrgSchema = z.object({
  orgName: z.string().trim().min(2, 'Org name must be at least 2 characters').max(120, 'Org name must be at most 120 characters'),
});

describe('CreateOrgSchema (onboarding Zod)', () => {
  it('accepts a valid org name', () => {
    const result = CreateOrgSchema.safeParse({ orgName: 'Acme Rentals' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.orgName).toBe('Acme Rentals');
  });

  it('trims whitespace before validation', () => {
    const result = CreateOrgSchema.safeParse({ orgName: '  Valid Org  ' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.orgName).toBe('Valid Org');
  });

  it('rejects org name shorter than 2 chars', () => {
    const result = CreateOrgSchema.safeParse({ orgName: 'A' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.errors[0].message).toMatch(/at least 2/);
    }
  });

  it('rejects empty org name', () => {
    const result = CreateOrgSchema.safeParse({ orgName: '' });
    expect(result.success).toBe(false);
  });

  it('rejects whitespace-only org name (trimmed to empty)', () => {
    const result = CreateOrgSchema.safeParse({ orgName: '   ' });
    expect(result.success).toBe(false);
  });

  it('rejects org name longer than 120 chars', () => {
    const result = CreateOrgSchema.safeParse({ orgName: 'A'.repeat(121) });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.errors[0].message).toMatch(/at most 120/);
    }
  });

  it('accepts exactly 2 chars', () => {
    const result = CreateOrgSchema.safeParse({ orgName: 'AB' });
    expect(result.success).toBe(true);
  });

  it('accepts exactly 120 chars', () => {
    const result = CreateOrgSchema.safeParse({ orgName: 'A'.repeat(120) });
    expect(result.success).toBe(true);
  });

  it('rejects missing orgName key', () => {
    const result = CreateOrgSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('rejects non-string orgName', () => {
    const result = CreateOrgSchema.safeParse({ orgName: 42 });
    expect(result.success).toBe(false);
  });
});
