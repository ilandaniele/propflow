import { describe, it, expect } from 'vitest';
import { parseCtwaReferral, extractRefCode } from '@/lib/whatsapp/referral';

describe('whatsapp/referral — parseCtwaReferral', () => {
  it('parses a ctwa referral with a ctwa_clid', () => {
    const result = parseCtwaReferral({
      source_id: '12345',
      source_type: 'ad',
      source_url: 'https://fb.me/ad',
      headline: 'Depto en Miraflores',
      ctwa_clid: 'abc.123',
    });
    expect(result).toEqual({
      type: 'ctwa',
      sourceId: '12345',
      sourceType: 'ad',
      sourceUrl: 'https://fb.me/ad',
      headline: 'Depto en Miraflores',
      ctwaClid: 'abc.123',
      refCode: null,
      listingId: null,
    });
  });

  it('parses a ctwa referral with only source_id (no ctwa_clid)', () => {
    const result = parseCtwaReferral({ source_id: '999' });
    expect(result?.sourceId).toBe('999');
    expect(result?.ctwaClid).toBeNull();
  });

  it('parses a ctwa referral with only ctwa_clid (no source_id)', () => {
    const result = parseCtwaReferral({ ctwa_clid: 'xyz.456' });
    expect(result?.ctwaClid).toBe('xyz.456');
    expect(result?.sourceId).toBeNull();
  });

  it('returns null when neither source_id nor ctwa_clid is present', () => {
    expect(parseCtwaReferral({ headline: 'no ids here' })).toBeNull();
  });

  it('returns null for a null referral', () => {
    expect(parseCtwaReferral(null)).toBeNull();
  });
});

describe('whatsapp/referral — extractRefCode', () => {
  it('extracts a ref code prefixed with "REF " and a space separator, uppercased', () => {
    expect(extractRefCode('Hola, quiero info del REF abc123')).toBe('ABC123');
  });

  it('extracts a ref code with a colon separator', () => {
    expect(extractRefCode('ref:ABC-123')).toBe('ABC-123');
  });

  it('extracts a ref code with a hash separator', () => {
    expect(extractRefCode('ref#XYZ999')).toBe('XYZ999');
  });

  it('extracts a ref code with a dash separator', () => {
    expect(extractRefCode('ref-XYZ999')).toBe('XYZ999');
  });

  it('returns null when there is no ref code', () => {
    expect(extractRefCode('Hola, quiero saber más de sus propiedades')).toBeNull();
  });

  it('returns null for a null text', () => {
    expect(extractRefCode(null)).toBeNull();
  });

  it('does not false-positive on the Spanish word "referencia"', () => {
    expect(extractRefCode('quiero una referencia de la propiedad')).toBeNull();
  });

  it('does not false-positive on "referido"', () => {
    expect(extractRefCode('me llegó por un referido')).toBeNull();
  });
});
