/**
 * Unit tests for src/lib/auth/admin-allowlist.ts
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { isAllowlistedAdmin, getAdminAllowlist, getPrimaryOwnerEmail } from '@/lib/auth/admin-allowlist';

describe('admin-allowlist', () => {
  const ORIG_ENV = { ...process.env };

  beforeEach(() => {
    delete process.env.ADMIN_ALLOWLIST;
    delete process.env.PRIMARY_OWNER_EMAIL;
  });
  afterEach(() => {
    process.env = { ...ORIG_ENV };
  });

  it('includes the two static co-admin emails', () => {
    expect(isAllowlistedAdmin('kbenites@studenthub.host')).toBe(true);
    expect(isAllowlistedAdmin('kiefbenites@gmail.com')).toBe(true);
  });

  it('is case-insensitive and trims whitespace', () => {
    expect(isAllowlistedAdmin('  KBenites@StudentHub.Host ')).toBe(true);
    expect(isAllowlistedAdmin('KIEFBENITES@GMAIL.COM')).toBe(true);
  });

  it('rejects non-allowlisted emails', () => {
    expect(isAllowlistedAdmin('someone@else.com')).toBe(false);
    expect(isAllowlistedAdmin('ilan.daniele@gmail.com')).toBe(false);
  });

  it('handles null/undefined/empty gracefully', () => {
    expect(isAllowlistedAdmin(null)).toBe(false);
    expect(isAllowlistedAdmin(undefined)).toBe(false);
    expect(isAllowlistedAdmin('')).toBe(false);
  });

  it('extends the allowlist via ADMIN_ALLOWLIST env (comma-separated, normalized)', () => {
    process.env.ADMIN_ALLOWLIST = 'Extra@Foo.com, second@bar.io';
    expect(isAllowlistedAdmin('extra@foo.com')).toBe(true);
    expect(isAllowlistedAdmin('second@bar.io')).toBe(true);
    // static entries still present
    expect(isAllowlistedAdmin('kbenites@studenthub.host')).toBe(true);
    expect(getAdminAllowlist().size).toBeGreaterThanOrEqual(4);
  });

  it('defaults the primary owner email and honors the env override', () => {
    expect(getPrimaryOwnerEmail()).toBe('ilan.daniele@gmail.com');
    process.env.PRIMARY_OWNER_EMAIL = 'Owner@Example.COM';
    expect(getPrimaryOwnerEmail()).toBe('owner@example.com');
  });
});
