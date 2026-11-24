import { describe, it, expect } from 'vitest';
import { addDays, expiryStatus, limaToday } from '@/lib/document-expirations/status';
import { CreateExpiringDocumentSchema } from '@/lib/document-expirations/schemas';

describe('limaToday', () => {
  it('uses Lima time, not UTC', () => {
    expect(limaToday(new Date('2026-12-01T03:00:00Z'))).toBe('2026-11-30');
    expect(limaToday(new Date('2026-12-01T06:00:00Z'))).toBe('2026-12-01');
  });
});

describe('addDays', () => {
  it('crosses month and year boundaries', () => {
    expect(addDays('2026-12-15', 30)).toBe('2027-01-14');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
  });
});

describe('expiryStatus', () => {
  it('classifies expired, soon (30-day window) and ok', () => {
    expect(expiryStatus('2026-11-22', '2026-11-23')).toBe('expired');
    expect(expiryStatus('2026-11-23', '2026-11-23')).toBe('soon');
    expect(expiryStatus('2026-12-23', '2026-11-23')).toBe('soon');
    expect(expiryStatus('2026-12-24', '2026-11-23')).toBe('ok');
  });
});

describe('CreateExpiringDocumentSchema', () => {
  const base = { kind: 'dni', label: ' DNI ', expires_on: '2027-01-01', tenant_id: '', property_id: '' };

  it('trims label and treats empty selects as absent', () => {
    const parsed = CreateExpiringDocumentSchema.parse(base);
    expect(parsed).toEqual({ kind: 'dni', label: 'DNI', expires_on: '2027-01-01', tenant_id: undefined, property_id: undefined });
  });

  it('rejects unknown kinds, blank labels and bad dates', () => {
    expect(CreateExpiringDocumentSchema.safeParse({ ...base, kind: 'passport' }).success).toBe(false);
    expect(CreateExpiringDocumentSchema.safeParse({ ...base, label: '  ' }).success).toBe(false);
    expect(CreateExpiringDocumentSchema.safeParse({ ...base, expires_on: '2027-1-1' }).success).toBe(false);
    expect(CreateExpiringDocumentSchema.safeParse({ ...base, tenant_id: 'nope' }).success).toBe(false);
  });
});
