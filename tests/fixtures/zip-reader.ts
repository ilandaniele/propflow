import { crc32 } from '@/lib/data-export/zip';

export async function collectBytes(source: AsyncIterable<Uint8Array>): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];
  for await (const part of source) parts.push(part);
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** Reads a STORE-only ZIP through its central directory, verifying every CRC. Returns name -> UTF-8 text. */
export function readStoredZip(zip: Uint8Array): Map<string, string> {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const eocd = zip.length - 22;
  if (view.getUint32(eocd, true) !== 0x06054b50) throw new Error('missing end of central directory');
  const count = view.getUint16(eocd + 10, true);
  let cursor = view.getUint32(eocd + 16, true);
  const decoder = new TextDecoder();
  const files = new Map<string, string>();

  for (let i = 0; i < count; i++) {
    if (view.getUint32(cursor, true) !== 0x02014b50) throw new Error('bad central header');
    if (view.getUint16(cursor + 10, true) !== 0) throw new Error('not stored');
    const crc = view.getUint32(cursor + 16, true);
    const size = view.getUint32(cursor + 20, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const localOffset = view.getUint32(cursor + 42, true);
    const name = decoder.decode(zip.subarray(cursor + 46, cursor + 46 + nameLength));

    if (view.getUint32(localOffset, true) !== 0x04034b50) throw new Error(`bad local header for ${name}`);
    const localNameLength = view.getUint16(localOffset + 26, true);
    const start = localOffset + 30 + localNameLength;
    const data = zip.subarray(start, start + size);
    if (crc32(data) !== crc) throw new Error(`crc mismatch for ${name}`);
    if (view.getUint32(start + size, true) !== 0x08074b50) throw new Error(`missing data descriptor for ${name}`);

    files.set(name, decoder.decode(data));
    cursor += 46 + nameLength;
  }
  return files;
}
