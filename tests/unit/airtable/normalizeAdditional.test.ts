import { describe, it, expect } from 'vitest';
import { normalizeAdditional } from '@/lib/airtable/normalizers/normalizeAdditional';
import type { AirtableRecord } from '@/lib/schemas/airtable';

const rec = (fields: Record<string, unknown>, id = 'recADD1'): AirtableRecord =>
  ({ id, createdTime: '2026-07-01T00:00:00.000Z', fields } as AirtableRecord);

describe('normalizeAdditional', () => {
  it('maps a complete Adicionales record', () => {
    const r = normalizeAdditional(rec({
      'Contrato': ['recCONTRACT1'],
      'Concepto': ['recCONCEPT1'],
      'Mes': 'Marzo',
      'Año': 2026,
      'Monto (S/)': 90,
      'Descripción / detalle': 'Cuota de limpieza',
      '#': 3,
    }));
    expect(r).not.toBeNull();
    expect(r!).toMatchObject({
      airtableExternalId: 'recADD1',
      contractAirtableId: 'recCONTRACT1',
      conceptAirtableId: 'recCONCEPT1',
      mes: 'Marzo',
      anio: 2026,
      amount: 90,
      description: 'Cuota de limpieza',
      numero: 3,
    });
  });

  it('coerces a string amount and tolerates missing links', () => {
    const r = normalizeAdditional(rec({ 'Monto (S/)': '150.50' }));
    expect(r!.amount).toBe(150.5);
    expect(r!.contractAirtableId).toBeNull();
    expect(r!.conceptAirtableId).toBeNull();
    expect(r!.mes).toBeNull();
  });

  it('returns null when the charge has no billable amount', () => {
    expect(normalizeAdditional(rec({ 'Monto (S/)': 0 }))).toBeNull();
    expect(normalizeAdditional(rec({ 'Monto (S/)': -5 }))).toBeNull();
    expect(normalizeAdditional(rec({}))).toBeNull();
  });
});
