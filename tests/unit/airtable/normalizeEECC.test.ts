import { describe, it, expect } from 'vitest';
import { normalizeEECC } from '@/lib/airtable/normalizers/normalizeEECC';
import type { AirtableRecord } from '@/lib/schemas/airtable';

const rec = (fields: Record<string, unknown>, id = 'recEECC1'): AirtableRecord =>
  ({ id, createdTime: '2026-07-01T00:00:00.000Z', fields } as AirtableRecord);

describe('normalizeEECC', () => {
  it('maps all money + status fields', () => {
    const r = normalizeEECC(rec({
      'EECC ID': 'EECC-001',
      'Contrato': ['recCONTRACT1'],
      'Mes': 'Junio',
      'Año': 2026,
      'Fecha de emisión': '2026-06-01',
      'Fecha de vencimiento': '2026-06-15',
      'PDF': [{ url: 'https://cdn.airtable.com/eecc.pdf' }],
      'Monto renta (S/)': 700,
      'Subtotal adicionales (S/)': 96.66,
      'Saldo anterior renta (S/)': 0,
      'Saldo anterior adicional (S/)': 0,
      'Total a pagar (S/)': 796.66,
      'Estado envío': 'sent',
      'WhatsApp Message ID': 'wamid.123',
    }));
    expect(r).not.toBeNull();
    expect(r!).toMatchObject({
      airtableExternalId: 'recEECC1',
      eeccCode: 'EECC-001',
      contractAirtableId: 'recCONTRACT1',
      mes: 'Junio',
      anio: 2026,
      dueDate: '2026-06-15',
      pdfUrl: 'https://cdn.airtable.com/eecc.pdf',
      rentAmount: 700,
      additionalSubtotal: 96.66,
      totalDue: 796.66,
      sendStatus: 'sent',
      whatsappMessageId: 'wamid.123',
    });
  });

  it('trims strings, nulls empties, and handles a missing PDF', () => {
    const r = normalizeEECC(rec({ 'EECC ID': '  E-2  ', 'Estado envío': '', 'PDF': [] }));
    expect(r!.eeccCode).toBe('E-2');
    expect(r!.sendStatus).toBeNull();
    expect(r!.pdfUrl).toBeNull();
    expect(r!.totalDue).toBeNull();
  });
});
