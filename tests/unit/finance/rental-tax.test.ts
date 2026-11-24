import { describe, it, expect } from 'vitest';
import { buildRentalTaxReport, rentalTax } from '@/lib/finance/rental-tax';

describe('rental tax report', () => {
  it('computes 5% rounded to cents', () => {
    expect(rentalTax(1234.5)).toBe(61.73);
  });

  it('groups by property and currency with monthly tax totals', () => {
    const { lines, totals } = buildRentalTaxReport([
      { propertyId: 'b', propertyName: 'Torre B', currency: 'PEN', month: 1, amount: 1000 },
      { propertyId: 'a', propertyName: 'Casa A', currency: 'PEN', month: 1, amount: 500 },
      { propertyId: 'a', propertyName: 'Casa A', currency: 'PEN', month: 3, amount: 500.25 },
      { propertyId: 'a', propertyName: 'Casa A', currency: 'USD', month: 2, amount: 300 },
    ]);

    expect(lines.map((line) => `${line.propertyName}:${line.currency}`)).toEqual(['Casa A:PEN', 'Casa A:USD', 'Torre B:PEN']);
    expect(lines[0]).toMatchObject({ total: 1000.25, tax: 50.01 });
    expect(lines[0].months.slice(0, 3)).toEqual([500, 0, 500.25]);

    const pen = totals.find((total) => total.currency === 'PEN')!;
    expect(pen.months[0]).toBe(1500);
    expect(pen.monthTax.slice(0, 3)).toEqual([75, 0, 25.01]);
    expect(pen).toMatchObject({ total: 2000.25, tax: 100.01 });
    expect(totals.map((total) => total.currency)).toEqual(['PEN', 'USD']);
  });

  it('returns empty report for no rows', () => {
    expect(buildRentalTaxReport([])).toEqual({ lines: [], totals: [] });
  });
});
