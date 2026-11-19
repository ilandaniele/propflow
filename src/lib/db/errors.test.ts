import { describe, expect, it } from 'vitest';
import { isConstraintError, isUniqueViolation } from './errors';

const d1Unique = new Error(
  'D1_ERROR: UNIQUE constraint failed: payments.org_id, payments.external_id: SQLITE_CONSTRAINT',
);
const d1Trigger = new Error('D1_ERROR: visit_overlap: SQLITE_CONSTRAINT');
const wrap = (cause: unknown) => new Error('Failed query: insert into ...', { cause });

describe('isUniqueViolation', () => {
  it('detects D1 unique errors directly and through cause chains', () => {
    expect(isUniqueViolation(d1Unique)).toBe(true);
    expect(isUniqueViolation(wrap(wrap(d1Unique)))).toBe(true);
  });

  it('filters by index or column', () => {
    expect(isUniqueViolation(wrap(d1Unique), 'payments.external_id')).toBe(true);
    expect(isUniqueViolation(wrap(d1Unique), 'charges.external_id')).toBe(false);
  });

  it('accepts Postgres 23505 on err or cause', () => {
    const pg = Object.assign(new Error('duplicate key'), { code: '23505', constraint: 'payments_ext_uq' });
    expect(isUniqueViolation(pg)).toBe(true);
    expect(isUniqueViolation(wrap(pg))).toBe(true);
    expect(isUniqueViolation(wrap(pg), 'payments_ext_uq')).toBe(true);
    expect(isUniqueViolation(wrap(pg), 'other_uq')).toBe(false);
  });

  it('rejects other errors and non-errors', () => {
    expect(isUniqueViolation(d1Trigger)).toBe(false);
    expect(isUniqueViolation(new Error('D1_ERROR: FOREIGN KEY constraint failed: SQLITE_CONSTRAINT'))).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation(undefined)).toBe(false);
    expect(isUniqueViolation('boom')).toBe(false);
  });

  it('survives cyclic cause chains', () => {
    const a = new Error('a');
    const b = new Error('b', { cause: a });
    (a as Error & { cause: unknown }).cause = b;
    expect(isUniqueViolation(a)).toBe(false);
  });
});

describe('isConstraintError', () => {
  it('matches trigger markers through cause chains', () => {
    expect(isConstraintError(d1Trigger, 'visit_overlap')).toBe(true);
    expect(isConstraintError(wrap(d1Trigger), 'visit_overlap')).toBe(true);
    expect(isConstraintError(wrap(d1Trigger), 'absence_overlap')).toBe(false);
    expect(isConstraintError({}, 'visit_overlap')).toBe(false);
  });
});
