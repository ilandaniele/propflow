import { describe, it, expect } from 'vitest';
import { isValidRuc, splitIgv, validateCustomerDoc } from '@/lib/einvoice/calc';
import { EmitEinvoiceSchema } from '@/lib/schemas/einvoice';

describe('splitIgv', () => {
  it('splits a total that includes 18% IGV', () => {
    expect(splitIgv('118')).toEqual({ total: '118.00', base: '100.00', igv: '18.00' });
    expect(splitIgv(1200)).toEqual({ total: '1200.00', base: '1016.95', igv: '183.05' });
  });

  it('keeps base + igv equal to the total after rounding', () => {
    for (const total of ['0.01', '1', '99.99', '350.5', '1234.56', '7000']) {
      const { base, igv } = splitIgv(total);
      expect(Math.round((Number(base) + Number(igv)) * 100)).toBe(Math.round(Number(total) * 100));
    }
  });

  it('rounds the base to 2 decimals', () => {
    expect(splitIgv('10')).toEqual({ total: '10.00', base: '8.47', igv: '1.53' });
  });
});

describe('isValidRuc', () => {
  it('accepts RUCs with a valid check digit', () => {
    expect(isValidRuc('20131312955')).toBe(true);
    expect(isValidRuc('20100070970')).toBe(true);
  });

  it('rejects a wrong check digit, wrong length or non-digits', () => {
    expect(isValidRuc('20131312954')).toBe(false);
    expect(isValidRuc('2013131295')).toBe(false);
    expect(isValidRuc('201313129555')).toBe(false);
    expect(isValidRuc('2013131295A')).toBe(false);
    expect(isValidRuc('')).toBe(false);
  });
});

describe('validateCustomerDoc', () => {
  it('requires a valid RUC for facturas', () => {
    expect(validateCustomerDoc('factura', 'ruc', '20131312955', 5000)).toBeNull();
    expect(validateCustomerDoc('factura', 'ruc', '20131312954', 5000)).toBe('invalid_ruc');
    expect(validateCustomerDoc('factura', 'dni', '12345678', 100)).toBe('ruc_required');
    expect(validateCustomerDoc('factura', 'none', '', 100)).toBe('ruc_required');
  });

  it('accepts an 8-digit DNI on boletas of any amount', () => {
    expect(validateCustomerDoc('boleta', 'dni', '12345678', 5000)).toBeNull();
    expect(validateCustomerDoc('boleta', 'dni', '1234567', 100)).toBe('invalid_dni');
  });

  it('allows anonymous boletas only under S/ 700', () => {
    expect(validateCustomerDoc('boleta', 'none', '', 699.99)).toBeNull();
    expect(validateCustomerDoc('boleta', 'none', '', 700)).toBe('document_required');
  });

  it('rejects a RUC on boletas', () => {
    expect(validateCustomerDoc('boleta', 'ruc', '20131312955', 100)).toBe('dni_or_none_required');
  });
});

describe('EmitEinvoiceSchema', () => {
  const base = {
    charge_id: '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b',
    doc_type: 'boleta',
    customer_doc_type: 'dni',
    customer_doc_number: '12345678',
    customer_name: 'Ana Pérez',
  };

  it('accepts a valid request', () => {
    expect(EmitEinvoiceSchema.safeParse(base).success).toBe(true);
  });

  it('rejects unknown doc types, non-numeric documents and empty names', () => {
    expect(EmitEinvoiceSchema.safeParse({ ...base, doc_type: 'nota' }).success).toBe(false);
    expect(EmitEinvoiceSchema.safeParse({ ...base, customer_doc_number: '12a45678' }).success).toBe(false);
    expect(EmitEinvoiceSchema.safeParse({ ...base, customer_name: ' ' }).success).toBe(false);
    expect(EmitEinvoiceSchema.safeParse({ ...base, charge_id: 'nope' }).success).toBe(false);
  });
});
