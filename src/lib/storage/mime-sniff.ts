/**
 * Magic-byte MIME type detection for uploaded image files.
 *
 * Pure JS implementation — no external dependencies.
 * Security: validates the actual binary content against known signatures,
 * preventing MIME spoofing where an attacker declares "image/jpeg" but
 * sends a PNG (or worse, a malicious file with a renamed extension).
 *
 * Implements ASVS V12.4 (malicious upload masking) controls.
 *
 * Supported signatures:
 *   JPEG:  FF D8 FF
 *   PNG:   89 50 4E 47 0D 0A 1A 0A  (8 bytes)
 *   WebP:  52 49 46 46 ?? ?? ?? ?? 57 45 42 50  (RIFF....WEBP at bytes 0-11)
 *
 * @param buffer  The uploaded file buffer (minimum 12 bytes needed for WebP detection)
 * @returns The detected MIME type string, or null if unknown / buffer too short
 */
export function sniffMimeType(buffer: Buffer): string | null {
  // Need at least 12 bytes to identify WebP (RIFF header + WEBP marker)
  if (!buffer || buffer.length < 3) return null;

  // JPEG: starts with FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }

  // PNG: starts with 89 50 4E 47 0D 0A 1A 0A (all 8 bytes required)
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 && // P
    buffer[2] === 0x4e && // N
    buffer[3] === 0x47 && // G
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return 'image/png';
  }

  // WebP: bytes 0-3 = "RIFF" (52 49 46 46), bytes 8-11 = "WEBP" (57 45 42 50)
  // Bytes 4-7 are file size (little-endian uint32) — we skip those.
  if (
    buffer.length >= 12 &&
    buffer[0] === 0x52 && // R
    buffer[1] === 0x49 && // I
    buffer[2] === 0x46 && // F
    buffer[3] === 0x46 && // F
    buffer[8] === 0x57 && // W
    buffer[9] === 0x45 && // E
    buffer[10] === 0x42 && // B
    buffer[11] === 0x50   // P
  ) {
    return 'image/webp';
  }

  return null;
}
