/**
 * Unit tests for src/lib/storage/path.ts — isSafeOrgScopedPath.
 */
import { describe, it, expect } from 'vitest';
import { isSafeOrgScopedPath } from '@/lib/storage/path';

const ORG = '550e8400-e29b-41d4-a716-446655440000';
const OTHER = '11111111-1111-1111-1111-111111111111';

describe('isSafeOrgScopedPath', () => {
  it('accepts a clean 3-segment path scoped to the org', () => {
    expect(isSafeOrgScopedPath(`${ORG}/incident-1/photo.jpg`, ORG)).toBe(true);
  });

  it('accepts extra trailing segments (still org-scoped)', () => {
    expect(isSafeOrgScopedPath(`${ORG}/a/b/c.png`, ORG)).toBe(true);
  });

  it('rejects null/empty', () => {
    expect(isSafeOrgScopedPath(null, ORG)).toBe(false);
    expect(isSafeOrgScopedPath('', ORG)).toBe(false);
    expect(isSafeOrgScopedPath(undefined, ORG)).toBe(false);
  });

  it('rejects path traversal (..)', () => {
    expect(isSafeOrgScopedPath(`${ORG}/../${OTHER}/secret.pdf`, ORG)).toBe(false);
    expect(isSafeOrgScopedPath(`${ORG}/x/../../y/z.jpg`, ORG)).toBe(false);
  });

  it("rejects a different org's prefix", () => {
    expect(isSafeOrgScopedPath(`${OTHER}/incident-1/photo.jpg`, ORG)).toBe(false);
  });

  it('rejects prefix trick (startsWith would have matched)', () => {
    // startsWith(orgId) would be true here, but the first segment isn't exactly orgId
    expect(isSafeOrgScopedPath(`${ORG}extra/incident/photo.jpg`, ORG)).toBe(false);
  });

  it('rejects too few segments', () => {
    expect(isSafeOrgScopedPath(`${ORG}/photo.jpg`, ORG)).toBe(false);
    expect(isSafeOrgScopedPath(`${ORG}`, ORG)).toBe(false);
  });

  it('rejects empty segments and control/special chars', () => {
    expect(isSafeOrgScopedPath(`${ORG}//photo.jpg`, ORG)).toBe(false);
    expect(isSafeOrgScopedPath(`${ORG}/incident/pho\0to.jpg`, ORG)).toBe(false);
    expect(isSafeOrgScopedPath(`${ORG}/incident/pho<to>.jpg`, ORG)).toBe(false);
  });
});
