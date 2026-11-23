import { describe, it, expect } from 'vitest';
import { AccentColorSchema, checkLogoFile, MAX_LOGO_BYTES, SaveBrandingSchema } from '@/lib/branding/validation';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBP')]);
const GIF = Buffer.from('GIF89a\0\0\0\0\0\0');
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>');

function padded(header: Buffer, size: number): Buffer {
  return Buffer.concat([header, Buffer.alloc(size - header.length)]);
}

describe('AccentColorSchema', () => {
  it('accepts six-digit hex colors and lowercases them', () => {
    expect(AccentColorSchema.parse('#1D4ED8')).toBe('#1d4ed8');
    expect(AccentColorSchema.parse('#000000')).toBe('#000000');
  });

  it.each(['1d4ed8', '#fff', '#1d4ed8ff', '#gggggg', 'red', 'rgb(0,0,0)', '#1d4ed8;color:red', ''])(
    'rejects %j',
    (value) => {
      expect(AccentColorSchema.safeParse(value).success).toBe(false);
    },
  );
});

describe('SaveBrandingSchema', () => {
  it('maps empty or missing accent color to null', () => {
    expect(SaveBrandingSchema.parse({ accent_color: '', remove_logo: null })).toEqual({ accent_color: null, remove_logo: false });
    expect(SaveBrandingSchema.parse({ accent_color: null, remove_logo: null }).accent_color).toBeNull();
  });

  it('reads remove_logo only from the literal string "true"', () => {
    expect(SaveBrandingSchema.parse({ accent_color: '#ABCDEF', remove_logo: 'true' })).toEqual({ accent_color: '#abcdef', remove_logo: true });
    expect(SaveBrandingSchema.parse({ accent_color: null, remove_logo: '1' }).remove_logo).toBe(false);
  });

  it('rejects an invalid accent color', () => {
    expect(SaveBrandingSchema.safeParse({ accent_color: 'blue', remove_logo: null }).success).toBe(false);
  });
});

describe('checkLogoFile', () => {
  it.each([
    [PNG, 'image/png'],
    [JPEG, 'image/jpeg'],
    [WEBP, 'image/webp'],
  ])('accepts a real %s matching its declared mime', (buffer, mime) => {
    expect(checkLogoFile(buffer, mime)).toEqual({ ok: true, mime });
  });

  it('rejects a spoofed mime whose bytes do not match', () => {
    expect(checkLogoFile(PNG, 'image/jpeg')).toEqual({ ok: false, code: 'IMAGE_INVALID_MIME' });
    expect(checkLogoFile(Buffer.from('not an image at all'), 'image/png')).toEqual({ ok: false, code: 'IMAGE_INVALID_MIME' });
  });

  it('rejects svg and gif', () => {
    expect(checkLogoFile(SVG, 'image/svg+xml')).toEqual({ ok: false, code: 'IMAGE_INVALID_MIME' });
    expect(checkLogoFile(GIF, 'image/gif')).toEqual({ ok: false, code: 'IMAGE_INVALID_MIME' });
  });

  it('accepts exactly 1 MB and rejects anything larger', () => {
    expect(checkLogoFile(padded(PNG, MAX_LOGO_BYTES), 'image/png').ok).toBe(true);
    expect(checkLogoFile(padded(PNG, MAX_LOGO_BYTES + 1), 'image/png')).toEqual({ ok: false, code: 'IMAGE_TOO_LARGE' });
  });
});
