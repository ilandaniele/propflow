import { describe, it, expect } from 'vitest';
import { canAccess, homePathFor, isStaffRole, navHrefsFor } from '@/lib/auth/permissions';

describe('canAccess', () => {
  it('full admin (null) reads and writes every area', () => {
    for (const area of ['finance', 'operations'] as const) {
      expect(canAccess(null, area, 'read')).toBe(true);
      expect(canAccess(null, area, 'write')).toBe(true);
    }
  });

  it('viewer reads every area but writes none', () => {
    expect(canAccess('viewer', 'finance', 'read')).toBe(true);
    expect(canAccess('viewer', 'operations', 'read')).toBe(true);
    expect(canAccess('viewer', 'finance', 'write')).toBe(false);
    expect(canAccess('viewer', 'operations', 'write')).toBe(false);
  });

  it('finance and operations only touch their own area', () => {
    expect(canAccess('finance', 'finance', 'write')).toBe(true);
    expect(canAccess('finance', 'operations', 'read')).toBe(false);
    expect(canAccess('operations', 'operations', 'write')).toBe(true);
    expect(canAccess('operations', 'finance', 'read')).toBe(false);
  });
});

describe('homePathFor / navHrefsFor / isStaffRole', () => {
  it('sends each role to a page it can open', () => {
    expect(homePathFor(null)).toBe('/dashboard');
    expect(homePathFor('finance')).toBe('/dashboard/finance');
    expect(homePathFor('operations')).toBe('/dashboard/incidents');
    expect(homePathFor('viewer')).toBe('/dashboard/incidents');
  });

  it('limits sidebar links for restricted roles', () => {
    expect(navHrefsFor(null)).toBeNull();
    expect(navHrefsFor('finance')).not.toContain('/dashboard/incidents');
    expect(navHrefsFor('operations')).toEqual(['/dashboard/incidents']);
    expect(navHrefsFor('viewer')).toEqual(expect.arrayContaining(['/dashboard/finance', '/dashboard/incidents']));
  });

  it('accepts only known roles', () => {
    expect(isStaffRole('viewer')).toBe(true);
    expect(isStaffRole('admin')).toBe(false);
    expect(isStaffRole(null)).toBe(false);
  });
});
