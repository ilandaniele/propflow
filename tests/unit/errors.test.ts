import { describe, it, expect } from 'vitest';
import { ok, err, Errors } from '@/lib/errors';

describe('ok', () => {
  it('wraps data in { data }', () => {
    expect(ok('hello')).toEqual({ data: 'hello' });
    expect(ok(42)).toEqual({ data: 42 });
    expect(ok(null)).toEqual({ data: null });
    expect(ok({ id: '1' })).toEqual({ data: { id: '1' } });
  });
});

describe('err', () => {
  it('returns error shape with code and message', () => {
    const result = err('MY_CODE', 'Something went wrong');
    expect(result).toEqual({ error: { code: 'MY_CODE', message: 'Something went wrong' } });
  });

  it('includes details when provided', () => {
    const result = err('VALIDATION_ERROR', 'Invalid', { field: ['required'] });
    expect(result.error?.details).toEqual({ field: ['required'] });
  });

  it('omits details when not provided', () => {
    const result = err('CODE', 'msg');
    expect(result.error?.details).toBeUndefined();
  });
});

describe('Errors', () => {
  it('UNAUTHORIZED returns correct code', () => {
    const r = Errors.UNAUTHORIZED();
    expect(r.error?.code).toBe('UNAUTHORIZED');
  });

  it('FORBIDDEN returns correct code', () => {
    const r = Errors.FORBIDDEN();
    expect(r.error?.code).toBe('FORBIDDEN');
  });

  it('NOT_FOUND returns correct code', () => {
    const r = Errors.NOT_FOUND();
    expect(r.error?.code).toBe('NOT_FOUND');
  });

  it('VALIDATION_ERROR includes details', () => {
    const details = { name: ['too short'] };
    const r = Errors.VALIDATION_ERROR(details);
    expect(r.error?.code).toBe('VALIDATION_ERROR');
    expect(r.error?.details).toEqual(details);
  });

  it('CONFLICT returns message passed in', () => {
    const r = Errors.CONFLICT('Email already in use');
    expect(r.error?.code).toBe('CONFLICT');
    expect(r.error?.message).toBe('Email already in use');
  });

  it('INTERNAL returns correct code', () => {
    const r = Errors.INTERNAL();
    expect(r.error?.code).toBe('INTERNAL_ERROR');
  });

  it('RATE_LIMITED returns correct code', () => {
    const r = Errors.RATE_LIMITED();
    expect(r.error?.code).toBe('RATE_LIMITED');
  });

  it('OAUTH_FAILED returns correct code', () => {
    const r = Errors.OAUTH_FAILED();
    expect(r.error?.code).toBe('OAUTH_FAILED');
  });

  it('PROVISION_FAILED returns correct code', () => {
    const r = Errors.PROVISION_FAILED();
    expect(r.error?.code).toBe('PROVISION_FAILED');
  });
});
