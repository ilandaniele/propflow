import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/db', () => ({ db: {} }));

import { formatCell, rowToCsvLine } from '@/lib/data-export/export';

describe('formatCell', () => {
  it('renders nulls as empty, dates as ISO and the rest as text', () => {
    expect(formatCell(null)).toBe('');
    expect(formatCell(undefined)).toBe('');
    expect(formatCell(new Date('2026-01-02T03:04:05.000Z'))).toBe('2026-01-02T03:04:05.000Z');
    expect(formatCell(true)).toBe('true');
    expect(formatCell(3)).toBe('3');
    expect(formatCell('850.00')).toBe('850.00');
  });
});

describe('rowToCsvLine', () => {
  it('follows header order, quotes and neutralises formulas', () => {
    const row = { name: 'Pérez, Ana', id: 't1', notes: '=HYPERLINK("x")', phone: '+51987654321', extra: 'ignored' };
    expect(rowToCsvLine(row, ['id', 'name', 'notes', 'phone'])).toBe(
      't1,"Pérez, Ana","\'=HYPERLINK(""x"")",+51987654321\r\n',
    );
  });
});
