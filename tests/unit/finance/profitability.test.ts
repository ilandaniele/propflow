import { describe, it, expect } from 'vitest';
import { buildProfitabilityReport } from '@/lib/finance/profitability';
import { profitabilityCsv } from '@/lib/finance/profitability-csv';
import { escapeCsvCell, toCsvDocument } from '@/lib/csv/write';

describe('buildProfitabilityReport', () => {
  it('splits currencies, charges expenses to PEN and sorts unassigned last', () => {
    const report = buildProfitabilityReport(
      [
        { propertyId: 'b', propertyName: 'Torre B', currency: 'USD', total: 500 },
        { propertyId: 'a', propertyName: 'Casa A', currency: 'PEN', total: 1200.555 },
      ],
      [
        { propertyId: 'a', propertyName: 'Casa A', total: 200.1 },
        { propertyId: 'b', propertyName: 'Torre B', total: 50 },
        { propertyId: null, propertyName: null, total: 30 },
      ],
    );

    expect(report.lines.map((line) => [line.propertyName, line.currency, line.income, line.expenses, line.net])).toEqual([
      ['Casa A', 'PEN', 1200.56, 200.1, 1000.46],
      ['Torre B', 'PEN', 0, 50, -50],
      ['Torre B', 'USD', 500, 0, 500],
      [null, 'PEN', 0, 30, -30],
    ]);
    expect(report.totals).toEqual({
      PEN: { income: 1200.56, expenses: 280.1, net: 920.46 },
      USD: { income: 500, expenses: 0, net: 500 },
    });
  });

  it('returns an empty report for no data', () => {
    expect(buildProfitabilityReport([], [])).toEqual({ lines: [], totals: {} });
  });
});

describe('csv writer', () => {
  it('guards formulas, quotes commas and keeps E.164 phones', () => {
    expect(escapeCsvCell('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(escapeCsvCell('+51987654321')).toBe('+51987654321');
    expect(escapeCsvCell('Av. Lima, 123')).toBe('"Av. Lima, 123"');
    expect(toCsvDocument(['a', 'b'], [[null, 1]])).toBe('﻿a,b\r\n,1\r\n');
  });

  it('renders profitability rows with totals', () => {
    const csv = profitabilityCsv(buildProfitabilityReport([{ propertyId: 'a', propertyName: 'Casa A', currency: 'PEN', total: 100 }], []));
    expect(csv).toBe('﻿property,currency,income,expenses,net\r\nCasa A,PEN,100.00,0.00,100.00\r\nTOTAL,PEN,100.00,0.00,100.00\r\n');
  });
});
