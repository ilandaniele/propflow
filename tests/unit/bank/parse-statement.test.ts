import { describe, it, expect } from 'vitest';
import { parseStatement, parseStatementAmount, parseStatementDate } from '@/lib/bank/parse-statement';

describe('parseStatementDate', () => {
  it('reads local and ISO dates', () => {
    expect(parseStatementDate('05/03/2026')).toBe('2026-03-05');
    expect(parseStatementDate('5-3-26')).toBe('2026-03-05');
    expect(parseStatementDate('2026-03-05')).toBe('2026-03-05');
    expect(parseStatementDate('ayer')).toBeNull();
  });
});

describe('parseStatementAmount', () => {
  it('handles currency, separators and negatives', () => {
    expect(parseStatementAmount('S/ 1,250.50')).toBe(1250.5);
    expect(parseStatementAmount('1.250,50')).toBe(1250.5);
    expect(parseStatementAmount('-80.00')).toBe(-80);
    expect(parseStatementAmount('(80.00)')).toBe(-80);
    expect(parseStatementAmount('')).toBeNull();
    expect(parseStatementAmount('abc')).toBeNull();
  });
});

describe('parseStatement', () => {
  it('finds the header after preamble rows and keeps only credits', () => {
    const csv = [
      'Banco X,Cuenta corriente',
      '',
      'Fecha,Descripción,Nro. Operación,Monto',
      '05/03/2026,TRANSF JUAN PEREZ,123,1200.00',
      '06/03/2026,COMISION,,-5.00',
      'basura,,,',
    ].join('\n');
    const result = parseStatement(csv);
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.skipped).toBe(2);
    expect(result.lines).toEqual([
      { fingerprint: '2026-03-05|1200.00|TRANSF JUAN PEREZ|123|1', postedOn: '2026-03-05', description: 'TRANSF JUAN PEREZ', reference: '123', amount: '1200.00' },
    ]);
  });

  it('supports separate credit and debit columns with semicolons', () => {
    const csv = 'Fecha;Concepto;Cargo;Abono\n01/04/2026;DEP EFECTIVO;;900,00\n02/04/2026;PAGO LUZ;120,00;';
    const result = parseStatement(csv);
    expect(result.status === 'ok' && result.lines.map((line) => line.amount)).toEqual(['900.00']);
  });

  it('gives repeated identical lines distinct fingerprints', () => {
    const csv = 'Fecha,Detalle,Importe\n01/04/2026,YAPE,50\n01/04/2026,YAPE,50';
    const result = parseStatement(csv);
    expect(result.status === 'ok' && result.lines.map((line) => line.fingerprint.endsWith('|1') || line.fingerprint.endsWith('|2'))).toEqual([true, true]);
    expect(result.status === 'ok' && new Set(result.lines.map((line) => line.fingerprint)).size).toBe(2);
  });

  it('reports missing header and oversized files', () => {
    expect(parseStatement('a,b,c\n1,2,3').status).toBe('no_header');
    const big = ['Fecha,Detalle,Monto', ...Array.from({ length: 1001 }, () => '01/04/2026,X,1')].join('\n');
    expect(parseStatement(big).status).toBe('too_many_rows');
  });
});
