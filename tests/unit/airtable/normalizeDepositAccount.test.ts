import { describe, it, expect } from 'vitest';
import { normalizeDepositAccount } from '@/lib/airtable/normalizers/normalizeDepositAccount';
import type { AirtableRecord } from '@/lib/schemas/airtable';

const ORG = '00000000-0000-0000-0000-000000000001';
const rec = (fields: Record<string, unknown>, id = 'recDEP1'): AirtableRecord =>
  ({ id, createdTime: '2026-07-01T00:00:00.000Z', fields } as AirtableRecord);

describe('normalizeDepositAccount', () => {
  it('maps bank fields and stamps org/external id', () => {
    const r = normalizeDepositAccount(rec({
      'Name': 'Cuenta BCP', 'Banco': 'BCP', 'Tipo de cuenta': 'Ahorros',
      'Moneda': 'PEN', 'N° de cuenta': '  191-123  ', 'CCI': '00219100012',
    }), ORG);
    expect(r).toMatchObject({
      org_id: ORG, airtable_external_id: 'recDEP1',
      name: 'Cuenta BCP', banco: 'BCP', tipo_cuenta: 'Ahorros',
      moneda: 'PEN', numero_cuenta: '191-123', cci: '00219100012',
    });
  });

  it('nulls missing fields', () => {
    const r = normalizeDepositAccount(rec({ 'Name': 'X' }), ORG);
    expect(r.banco).toBeNull();
    expect(r.numero_cuenta).toBeNull();
  });
});
