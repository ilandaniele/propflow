// Minimal streaming ZIP writer: STORE method (no compression), UTF-8 names,
// sizes and CRC written after each file in a data descriptor so nothing is
// buffered beyond the current chunk. No ZIP64: callers cap total size well under 4 GiB.

export type ZipEntry = { name: string; chunks: AsyncIterable<Uint8Array> };

const FLAGS = 0x0808; // bit 3: data descriptor, bit 11: UTF-8 names
const VERSION = 20;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(data: Uint8Array, previous = 0): number {
  let crc = ~previous >>> 0;
  for (let i = 0; i < data.length; i++) crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  return ~crc >>> 0;
}

function dosDateTime(date: Date): { time: number; day: number } {
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    day: ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

function record(size: number, write: (view: DataView) => void): Uint8Array {
  const bytes = new Uint8Array(size);
  write(new DataView(bytes.buffer));
  return bytes;
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}

type Written = { name: Uint8Array; crc: number; size: number; offset: number };

function localHeader(name: Uint8Array, stamp: { time: number; day: number }): Uint8Array {
  return concat(record(30, (v) => {
    v.setUint32(0, 0x04034b50, true);
    v.setUint16(4, VERSION, true);
    v.setUint16(6, FLAGS, true);
    v.setUint16(10, stamp.time, true);
    v.setUint16(12, stamp.day, true);
    v.setUint16(26, name.length, true);
  }), name);
}

function dataDescriptor(crc: number, size: number): Uint8Array {
  return record(16, (v) => {
    v.setUint32(0, 0x08074b50, true);
    v.setUint32(4, crc, true);
    v.setUint32(8, size, true);
    v.setUint32(12, size, true);
  });
}

function centralHeader(file: Written, stamp: { time: number; day: number }): Uint8Array {
  return concat(record(46, (v) => {
    v.setUint32(0, 0x02014b50, true);
    v.setUint16(4, VERSION, true);
    v.setUint16(6, VERSION, true);
    v.setUint16(8, FLAGS, true);
    v.setUint16(12, stamp.time, true);
    v.setUint16(14, stamp.day, true);
    v.setUint32(16, file.crc, true);
    v.setUint32(20, file.size, true);
    v.setUint32(24, file.size, true);
    v.setUint16(28, file.name.length, true);
    v.setUint32(42, file.offset, true);
  }), file.name);
}

function endOfCentralDirectory(count: number, size: number, offset: number): Uint8Array {
  return record(22, (v) => {
    v.setUint32(0, 0x06054b50, true);
    v.setUint16(8, count, true);
    v.setUint16(10, count, true);
    v.setUint32(12, size, true);
    v.setUint32(16, offset, true);
  });
}

export async function* zipStore(entries: Iterable<ZipEntry>, now = new Date()): AsyncGenerator<Uint8Array> {
  const stamp = dosDateTime(now);
  const encoder = new TextEncoder();
  const written: Written[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const header = localHeader(name, stamp);
    const file: Written = { name, crc: 0, size: 0, offset };
    yield header;
    offset += header.length;
    for await (const chunk of entry.chunks) {
      file.crc = crc32(chunk, file.crc);
      file.size += chunk.length;
      offset += chunk.length;
      yield chunk;
    }
    const descriptor = dataDescriptor(file.crc, file.size);
    yield descriptor;
    offset += descriptor.length;
    written.push(file);
  }

  const directoryStart = offset;
  let directorySize = 0;
  for (const file of written) {
    const central = centralHeader(file, stamp);
    directorySize += central.length;
    yield central;
  }
  yield endOfCentralDirectory(written.length, directorySize, directoryStart);
}

export function toReadableStream(source: AsyncIterator<Uint8Array>, onError: (error: unknown) => void): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { value, done } = await source.next();
        if (done) controller.close();
        else controller.enqueue(value);
      } catch (error) {
        onError(error);
        controller.error(error);
      }
    },
    async cancel() {
      await source.return?.(undefined);
    },
  });
}
