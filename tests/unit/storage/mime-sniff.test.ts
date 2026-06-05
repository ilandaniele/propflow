import { describe, it, expect } from 'vitest';
import { sniffMimeType } from '@/lib/storage/mime-sniff';

// ---------------------------------------------------------------------------
// Real magic-byte headers
// ---------------------------------------------------------------------------

/** Minimal valid JPEG: starts with FF D8 FF (followed by E0 for SOF marker) */
function jpegBuffer(): Buffer {
  return Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
}

/** Minimal valid PNG: 89 50 4E 47 0D 0A 1A 0A */
function pngBuffer(): Buffer {
  return Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
}

/**
 * Minimal valid WebP: "RIFF" (52 49 46 46) + 4 size bytes + "WEBP" (57 45 42 50)
 * Total: 12 bytes minimum
 */
function webpBuffer(): Buffer {
  return Buffer.from([
    0x52, 0x49, 0x46, 0x46, // RIFF
    0x24, 0x00, 0x00, 0x00, // file size (LE uint32 — value doesn't matter for sniff)
    0x57, 0x45, 0x42, 0x50, // WEBP
  ]);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('sniffMimeType', () => {
  describe('JPEG detection', () => {
    it('returns image/jpeg for a valid JPEG header', () => {
      expect(sniffMimeType(jpegBuffer())).toBe('image/jpeg');
    });

    it('returns image/jpeg for FF D8 FF E1 (Exif JPEG)', () => {
      const buf = Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x18]);
      expect(sniffMimeType(buf)).toBe('image/jpeg');
    });

    it('returns image/jpeg for FF D8 FF DB (raw JPEG without JFIF marker)', () => {
      const buf = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x43]);
      expect(sniffMimeType(buf)).toBe('image/jpeg');
    });
  });

  describe('PNG detection', () => {
    it('returns image/png for a valid PNG header', () => {
      expect(sniffMimeType(pngBuffer())).toBe('image/png');
    });

    it('returns null when PNG header is truncated to 7 bytes', () => {
      const truncated = pngBuffer().subarray(0, 7);
      expect(sniffMimeType(truncated)).toBeNull();
    });
  });

  describe('WebP detection', () => {
    it('returns image/webp for a valid WebP header', () => {
      expect(sniffMimeType(webpBuffer())).toBe('image/webp');
    });

    it('returns null when WebP buffer is only 11 bytes (missing last WEBP byte)', () => {
      const truncated = webpBuffer().subarray(0, 11);
      expect(sniffMimeType(truncated)).toBeNull();
    });

    it('returns null for RIFF header without WEBP marker (e.g. WAV audio)', () => {
      // RIFF....WAVE
      const buf = Buffer.from([
        0x52, 0x49, 0x46, 0x46,
        0x24, 0x00, 0x00, 0x00,
        0x57, 0x41, 0x56, 0x45, // WAVE
      ]);
      expect(sniffMimeType(buf)).toBeNull();
    });
  });

  describe('Unknown / spoofed MIME cases', () => {
    it('returns null for a buffer that is all zeros', () => {
      expect(sniffMimeType(Buffer.alloc(12))).toBeNull();
    });

    it('returns null for a buffer with fewer than 3 bytes', () => {
      expect(sniffMimeType(Buffer.from([0xff, 0xd8]))).toBeNull();
    });

    it('returns null for empty buffer', () => {
      expect(sniffMimeType(Buffer.alloc(0))).toBeNull();
    });

    it('returns image/png for PNG bytes even when declared as image/jpeg (spoofed MIME)', () => {
      // The sniffMimeType function detects the ACTUAL type from magic bytes.
      // The caller (validateImageFile) then compares this to the declared type
      // and rejects when they do not match.
      const pngBytes = pngBuffer();
      const sniffed = sniffMimeType(pngBytes);
      expect(sniffed).toBe('image/png');
      // Caller comparison: sniffed !== 'image/jpeg' → reject
      expect(sniffed).not.toBe('image/jpeg');
    });

    it('returns image/jpeg for JPEG bytes even when declared as image/png', () => {
      const jpegBytes = jpegBuffer();
      const sniffed = sniffMimeType(jpegBytes);
      expect(sniffed).toBe('image/jpeg');
      expect(sniffed).not.toBe('image/png');
    });

    it('returns null for an SVG file (XML text — not image/jpeg/png/webp)', () => {
      // SVG starts with <?xml or <svg
      const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
      expect(sniffMimeType(svg)).toBeNull();
    });

    it('returns null for a GIF file (47 49 46 38) — not in allowlist', () => {
      const gif = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
      expect(sniffMimeType(gif)).toBeNull();
    });
  });

  describe('Buffer edge cases', () => {
    it('handles exactly 3 bytes — JPEG detection works', () => {
      const minJpeg = Buffer.from([0xff, 0xd8, 0xff]);
      expect(sniffMimeType(minJpeg)).toBe('image/jpeg');
    });

    it('handles exactly 8 bytes — PNG detection works', () => {
      const minPng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      expect(sniffMimeType(minPng)).toBe('image/png');
    });

    it('handles exactly 12 bytes — WebP detection works', () => {
      expect(sniffMimeType(webpBuffer())).toBe('image/webp');
    });
  });
});
