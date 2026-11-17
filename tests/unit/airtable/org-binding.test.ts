/**
 * tests/unit/airtable/org-binding.test.ts
 *
 * The Airtable base is bound to ONE org: AIRTABLE_ORG_ID when set, else the
 * primary owner's org (resolvePrimaryOrgId).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const resolvePrimaryOrgId = vi.fn();

vi.mock('@/lib/auth/provision', () => ({
  resolvePrimaryOrgId: () => resolvePrimaryOrgId(),
}));

import { getAirtableOrgId, isAirtableOrg } from '@/lib/airtable/org-binding';

const ORIGINAL_ENV = process.env['AIRTABLE_ORG_ID'];

beforeEach(() => {
  resolvePrimaryOrgId.mockReset();
  delete process.env['AIRTABLE_ORG_ID'];
});

afterEach(() => {
  if (ORIGINAL_ENV === undefined) delete process.env['AIRTABLE_ORG_ID'];
  else process.env['AIRTABLE_ORG_ID'] = ORIGINAL_ENV;
});

describe('getAirtableOrgId', () => {
  it('returns AIRTABLE_ORG_ID (trimmed) when set, without resolving the primary org', async () => {
    process.env['AIRTABLE_ORG_ID'] = '  org-env  ';
    await expect(getAirtableOrgId()).resolves.toBe('org-env');
    expect(resolvePrimaryOrgId).not.toHaveBeenCalled();
  });

  it('falls back to resolvePrimaryOrgId when AIRTABLE_ORG_ID is unset', async () => {
    resolvePrimaryOrgId.mockResolvedValue('org-primary');
    await expect(getAirtableOrgId()).resolves.toBe('org-primary');
  });

  it('falls back to resolvePrimaryOrgId when AIRTABLE_ORG_ID is blank', async () => {
    process.env['AIRTABLE_ORG_ID'] = '   ';
    resolvePrimaryOrgId.mockResolvedValue('org-primary');
    await expect(getAirtableOrgId()).resolves.toBe('org-primary');
  });

  it('returns null when no org exists at all', async () => {
    resolvePrimaryOrgId.mockResolvedValue(null);
    await expect(getAirtableOrgId()).resolves.toBeNull();
  });
});

describe('isAirtableOrg', () => {
  it('is true only for the bound org', async () => {
    process.env['AIRTABLE_ORG_ID'] = 'org-env';
    await expect(isAirtableOrg('org-env')).resolves.toBe(true);
    await expect(isAirtableOrg('org-other')).resolves.toBe(false);
  });

  it('is false for everyone when no org is bound', async () => {
    resolvePrimaryOrgId.mockResolvedValue(null);
    await expect(isAirtableOrg('org-any')).resolves.toBe(false);
  });

  it('is false for an empty org id', async () => {
    process.env['AIRTABLE_ORG_ID'] = 'org-env';
    await expect(isAirtableOrg('')).resolves.toBe(false);
  });
});
