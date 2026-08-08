import { describe, it, expect } from 'vitest';
import { normalizeTaxReceipt } from '@/lib/airtable/normalizers/normalizeTaxReceipt';
import type { AirtableRecord } from '@/lib/schemas/airtable';

const rec = (fields: Record<string, unknown>, id = 'recTAX1'): AirtableRecord =>
  ({ id, createdTime: '2026-07-01T00:00:00.000Z', fields } as AirtableRecord);

describe('normalizeTaxReceipt', () => {
  it('maps a complete comprobante record', () => {
    const r = normalizeTaxReceipt(rec({
      'Comprobante ID': 'C-001',
      'Tipo': 'factura',
      'Número de comprobante': 'F001-123',
      'Mes': 'Julio',
      'Año': 2026,
      'Fecha de emisión': '2026-07-05',
      'Monto base (S/)': 100,
      'Incluye IGV': true,
      'IGV 18% (S/)': 18,
      'Monto total (S/)': 118,
      'Archivo': [{ url: 'https://cdn.airtable.com/f.pdf' }],
      'Estado': 'issued',
      'Historial (Contratos)': ['recCONTRACT1'],
    }));
    expect(r).not.toBeNull();
    expect(r!).toMatchObject({
      airtableExternalId: 'recTAX1',
      receiptCode: 'C-001',
      tipo: 'factura',
      numero: 'F001-123',
      anio: 2026,
      baseAmount: 100,
      includesIgv: true,
      igvAmount: 18,
      totalAmount: 118,
      status: 'issued',
      fileUrl: 'https://cdn.airtable.com/f.pdf',
      contractAirtableId: 'recCONTRACT1',
    });
  });

  it('includesIgv is strictly boolean true only (not truthy coercion)', () => {
    expect(normalizeTaxReceipt(rec({ 'Incluye IGV': 'yes' }))!.includesIgv).toBe(false);
    expect(normalizeTaxReceipt(rec({ 'Incluye IGV': 1 }))!.includesIgv).toBe(false);
    expect(normalizeTaxReceipt(rec({}))!.includesIgv).toBe(false);
    expect(normalizeTaxReceipt(rec({ 'Incluye IGV': true }))!.includesIgv).toBe(true);
  });

  it('nulls missing money fields and file', () => {
    const r = normalizeTaxReceipt(rec({ 'Estado': 'draft' }));
    expect(r!.baseAmount).toBeNull();
    expect(r!.igvAmount).toBeNull();
    expect(r!.totalAmount).toBeNull();
    expect(r!.fileUrl).toBeNull();
    expect(r!.status).toBe('draft');
  });
});
