import { describe, it, expect } from 'vitest';
import { escapeCsvCell, toCsvDocument } from '@/lib/csv/cell';

describe('escapeCsvCell', () => {
  it('guards formula prefixes but not phone numbers', () => {
    expect(escapeCsvCell('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(escapeCsvCell('+51987654321')).toBe('+51987654321');
  });

  it('quotes commas and quotes', () => {
    expect(escapeCsvCell('a,b')).toBe('"a,b"');
    expect(escapeCsvCell('say "hi"')).toBe('"say ""hi"""');
  });
});

describe('toCsvDocument', () => {
  it('writes a BOM, header and CRLF rows', () => {
    expect(toCsvDocument(['a', 'b'], [['1', 'x,y']])).toBe('﻿a,b\r\n1,"x,y"\r\n');
  });
});
