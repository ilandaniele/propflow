import { describe, it, expect, vi } from 'vitest';
import { crc32, toReadableStream, zipStore } from '@/lib/data-export/zip';
import { collectBytes, readStoredZip } from '../../fixtures/zip-reader';

const encoder = new TextEncoder();

async function* chunks(...parts: string[]): AsyncGenerator<Uint8Array> {
  for (const part of parts) yield encoder.encode(part);
}

describe('crc32', () => {
  it('matches the standard check value', () => {
    expect(crc32(encoder.encode('123456789'))).toBe(0xcbf43926);
  });

  it('is incremental across chunks', () => {
    const whole = crc32(encoder.encode('hola mundo'));
    expect(crc32(encoder.encode('mundo'), crc32(encoder.encode('hola ')))).toBe(whole);
  });

  it('is 0 for empty input', () => {
    expect(crc32(new Uint8Array())).toBe(0);
  });
});

describe('zipStore', () => {
  it('writes a readable archive with multi-chunk, empty and UTF-8 named entries', async () => {
    const zip = await collectBytes(zipStore([
      { name: 'a.csv', chunks: chunks('id,name\r\n', '1,Ñandú\r\n') },
      { name: 'vacío.csv', chunks: chunks() },
      { name: 'b.csv', chunks: chunks('x') },
    ]));
    const files = readStoredZip(zip);
    expect([...files.keys()]).toEqual(['a.csv', 'vacío.csv', 'b.csv']);
    expect(files.get('a.csv')).toBe('id,name\r\n1,Ñandú\r\n');
    expect(files.get('vacío.csv')).toBe('');
    expect(files.get('b.csv')).toBe('x');
  });

  it('writes an empty archive as a lone end-of-central-directory record', async () => {
    const zip = await collectBytes(zipStore([]));
    expect(zip.length).toBe(22);
    expect(readStoredZip(zip).size).toBe(0);
  });
});

describe('toReadableStream', () => {
  it('streams every chunk then closes', async () => {
    const stream = toReadableStream(chunks('a', 'b'), vi.fn());
    expect(await new Response(stream).text()).toBe('ab');
  });

  it('reports and propagates a source failure', async () => {
    async function* failing(): AsyncGenerator<Uint8Array> {
      yield encoder.encode('a');
      throw new Error('db down');
    }
    const onError = vi.fn();
    await expect(new Response(toReadableStream(failing(), onError)).text()).rejects.toThrow('db down');
    expect(onError).toHaveBeenCalledOnce();
  });
});
