import { describe, it, expect } from 'vitest';
import { isValidSignatureImage } from '@/lib/contracts/org-signature';
import { ALLOWED_VARIABLES, interpolateTemplate } from '@/lib/contracts/pdf.tsx';
import { SAMPLE_VARIABLES } from '@/lib/contracts/sample-variables';

const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function pngDataUrl(payload: Buffer): string {
  return `data:image/png;base64,${payload.toString('base64')}`;
}

describe('isValidSignatureImage', () => {
  it('accepts a PNG data URL', () => {
    expect(isValidSignatureImage(pngDataUrl(Buffer.concat([PNG_HEADER, Buffer.alloc(64)])))).toBe(true);
  });

  it('rejects bytes that are not a PNG', () => {
    expect(isValidSignatureImage(pngDataUrl(Buffer.from('<svg onload=alert(1)>')))).toBe(false);
  });

  it('rejects a non-PNG data URL prefix', () => {
    expect(isValidSignatureImage(`data:image/svg+xml;base64,${PNG_HEADER.toString('base64')}`)).toBe(false);
  });

  it('rejects images over 150 KB', () => {
    expect(isValidSignatureImage(pngDataUrl(Buffer.concat([PNG_HEADER, Buffer.alloc(150_001)])))).toBe(false);
  });
});

describe('contract template variables', () => {
  it('has a sample value for every allowed variable, so the preview never shows raw tokens', () => {
    const body = ALLOWED_VARIABLES.map((key) => `{{${key}}}`).join(' ');
    expect(interpolateTemplate(body, SAMPLE_VARIABLES)).not.toContain('{{');
  });

  it('fills the new landlord and tenant variables', () => {
    const body = '{{landlord_name}} ({{landlord_document}}) alquila a {{tenant_name}} DNI {{tenant_document}}, pago el día {{payment_day}}.';
    expect(interpolateTemplate(body, {
      landlord_name: 'Juan', landlord_document: '87654321', tenant_name: 'Ana', tenant_document: '12345678', payment_day: '5',
    })).toBe('Juan (87654321) alquila a Ana DNI 12345678, pago el día 5.');
  });
});
