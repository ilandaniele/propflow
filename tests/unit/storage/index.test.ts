import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  validateImageFile,
  buildStoragePath,
  ALLOWED_MIME_TYPES,
  MAX_IMAGE_SIZE_BYTES,
} from '@/lib/storage/index';

// ---------------------------------------------------------------------------
// Magic-byte buffers
// ---------------------------------------------------------------------------

function jpegBuffer(size?: number): Buffer {
  const header = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
  if (!size || size <= header.length) return header;
  return Buffer.concat([header, Buffer.alloc(size - header.length)]);
}

function pngBuffer(size?: number): Buffer {
  const header = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
  if (!size || size <= header.length) return header;
  return Buffer.concat([header, Buffer.alloc(size - header.length)]);
}

function webpBuffer(): Buffer {
  return Buffer.from([
    0x52, 0x49, 0x46, 0x46,
    0x24, 0x00, 0x00, 0x00,
    0x57, 0x45, 0x42, 0x50,
  ]);
}

// ---------------------------------------------------------------------------
// validateImageFile tests
// ---------------------------------------------------------------------------

describe('validateImageFile', () => {
  describe('happy path', () => {
    it('accepts a valid JPEG file with correct declared MIME', () => {
      const result = validateImageFile(jpegBuffer(), 'image/jpeg');
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
      expect(result.sniffedMime).toBe('image/jpeg');
    });

    it('accepts a valid PNG file with correct declared MIME', () => {
      const result = validateImageFile(pngBuffer(), 'image/png');
      expect(result.valid).toBe(true);
      expect(result.sniffedMime).toBe('image/png');
    });

    it('accepts a valid WebP file with correct declared MIME', () => {
      const result = validateImageFile(webpBuffer(), 'image/webp');
      expect(result.valid).toBe(true);
      expect(result.sniffedMime).toBe('image/webp');
    });

    it('accepts a JPEG file exactly at the 5 MB limit', () => {
      const fiveMb = jpegBuffer(MAX_IMAGE_SIZE_BYTES);
      const result = validateImageFile(fiveMb, 'image/jpeg');
      expect(result.valid).toBe(true);
    });
  });

  describe('MIME type validation', () => {
    it('rejects image/gif — not in allowlist', () => {
      const buf = Buffer.from([0x47, 0x49, 0x46, 0x38]); // GIF header
      const result = validateImageFile(buf, 'image/gif');
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/not allowed/i);
    });

    it('rejects image/svg+xml — not in allowlist (XSS vector)', () => {
      const buf = Buffer.from('<svg></svg>');
      const result = validateImageFile(buf, 'image/svg+xml');
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/not allowed/i);
    });

    it('rejects text/plain', () => {
      const buf = Buffer.from('hello world');
      const result = validateImageFile(buf, 'text/plain');
      expect(result.valid).toBe(false);
    });

    it('rejects application/pdf', () => {
      const buf = Buffer.from('%PDF-1.4');
      const result = validateImageFile(buf, 'application/pdf');
      expect(result.valid).toBe(false);
    });
  });

  describe('size validation', () => {
    it('rejects a file 1 byte over the 5 MB limit (AC4 — IMAGE_TOO_LARGE)', () => {
      const oversize = jpegBuffer(MAX_IMAGE_SIZE_BYTES + 1);
      const result = validateImageFile(oversize, 'image/jpeg');
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/exceeds maximum/i);
    });

    it('accepts a custom maxBytes override', () => {
      const twoMb = 2 * 1024 * 1024;
      const buf = jpegBuffer(twoMb + 1);
      const result = validateImageFile(buf, 'image/jpeg', twoMb);
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/exceeds maximum/i);
    });
  });

  describe('magic-byte mismatch — AC3 (spoofed MIME)', () => {
    it('rejects PNG bytes declared as image/jpeg', () => {
      const result = validateImageFile(pngBuffer(), 'image/jpeg');
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/does not match/i);
      expect(result.sniffedMime).toBe('image/png');
    });

    it('rejects JPEG bytes declared as image/png', () => {
      const result = validateImageFile(jpegBuffer(), 'image/png');
      expect(result.valid).toBe(false);
      expect(result.sniffedMime).toBe('image/jpeg');
    });

    it('rejects WebP bytes declared as image/jpeg', () => {
      const result = validateImageFile(webpBuffer(), 'image/jpeg');
      expect(result.valid).toBe(false);
      expect(result.sniffedMime).toBe('image/webp');
    });

    it('rejects a file with unrecognised magic bytes declared as image/jpeg', () => {
      const unknown = Buffer.alloc(16); // all zeros
      const result = validateImageFile(unknown, 'image/jpeg');
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/unknown magic bytes|does not match/i);
    });
  });

  describe('ALLOWED_MIME_TYPES constant', () => {
    it('contains exactly the three allowed types', () => {
      expect(ALLOWED_MIME_TYPES).toEqual(['image/jpeg', 'image/png', 'image/webp']);
    });
  });
});

// ---------------------------------------------------------------------------
// buildStoragePath tests
// ---------------------------------------------------------------------------

describe('buildStoragePath', () => {
  it('returns a path in the format {orgId}/{resourceId}/{uuid}.{ext}', () => {
    const path = buildStoragePath('org1', 'res1', 'image/jpeg');
    const parts = path.split('/');
    expect(parts).toHaveLength(3);
    expect(parts[0]).toBe('org1');
    expect(parts[1]).toBe('res1');
    expect(parts[2]).toMatch(/^[0-9a-f-]{36}\.jpg$/);
  });

  it('uses .jpg extension for image/jpeg', () => {
    const path = buildStoragePath('o', 'r', 'image/jpeg');
    expect(path).toMatch(/\.jpg$/);
  });

  it('uses .png extension for image/png', () => {
    const path = buildStoragePath('o', 'r', 'image/png');
    expect(path).toMatch(/\.png$/);
  });

  it('uses .webp extension for image/webp', () => {
    const path = buildStoragePath('o', 'r', 'image/webp');
    expect(path).toMatch(/\.webp$/);
  });

  it('generates different UUIDs on each call (no collisions)', () => {
    const a = buildStoragePath('o', 'r', 'image/jpeg');
    const b = buildStoragePath('o', 'r', 'image/jpeg');
    expect(a).not.toBe(b);
  });

  it('path traversal: original filename is NOT part of the path', () => {
    // ASVS V12.3.1 — path is always {orgId}/{resourceId}/{uuid}.{ext}
    // There is no parameter for the original filename in buildStoragePath.
    // This test documents that the function signature enforces path safety.
    const path = buildStoragePath('org', 'unit', 'image/jpeg');
    expect(path).not.toContain('..');
    expect(path).not.toContain('etc');
    expect(path).not.toContain('passwd');
  });
});
