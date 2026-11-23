import { describe, it, expect } from 'vitest';
import { AuthorizedVisitorSchema, PassphraseSchema, RemoveAuthorizedVisitorSchema } from '@/lib/visitors/schemas';
import { VisitorLogSchema } from '@/lib/schemas/community';

const UNIT = '11111111-1111-4111-8111-111111111111';

describe('PassphraseSchema', () => {
  it('treats blank input as absent', () => {
    expect(PassphraseSchema.parse('')).toBeUndefined();
    expect(PassphraseSchema.parse('   ')).toBeUndefined();
    expect(PassphraseSchema.parse(undefined)).toBeUndefined();
  });

  it('trims and enforces 5 to 40 characters', () => {
    expect(PassphraseSchema.parse('  azul42  ')).toBe('azul42');
    expect(PassphraseSchema.safeParse('abcd').success).toBe(false);
    expect(PassphraseSchema.safeParse('x'.repeat(41)).success).toBe(false);
  });
});

describe('VisitorLogSchema passphrase', () => {
  const base = { visitor_name: 'Visita', visit_date: '2026-11-23' };

  it('accepts a log without passphrase', () => {
    expect(VisitorLogSchema.parse({ ...base, passphrase: '' }).passphrase).toBeUndefined();
  });

  it('rejects a too short passphrase', () => {
    expect(VisitorLogSchema.safeParse({ ...base, passphrase: 'abc' }).success).toBe(false);
  });
});

describe('AuthorizedVisitorSchema', () => {
  it('normalizes empty optional fields', () => {
    const parsed = AuthorizedVisitorSchema.parse({ unit_id: '', full_name: ' Ana ', document_number: '', relationship: '' });
    expect(parsed).toEqual({ full_name: 'Ana' });
  });

  it('accepts a unit id and rejects a missing name', () => {
    expect(AuthorizedVisitorSchema.parse({ unit_id: UNIT, full_name: 'Ana' }).unit_id).toBe(UNIT);
    expect(AuthorizedVisitorSchema.safeParse({ full_name: '  ' }).success).toBe(false);
    expect(AuthorizedVisitorSchema.safeParse({ unit_id: 'nope', full_name: 'Ana' }).success).toBe(false);
  });

  it('requires a guid to remove', () => {
    expect(RemoveAuthorizedVisitorSchema.safeParse({ id: 'x' }).success).toBe(false);
    expect(RemoveAuthorizedVisitorSchema.safeParse({ id: UNIT }).success).toBe(true);
  });
});
