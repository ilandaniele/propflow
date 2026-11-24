import { describe, it, expect } from 'vitest';
import { buildOwnerSettlements } from '@/lib/finance/owner-settlement';
import { SettlementQuerySchema, PropertyOwnerTermsSchema } from '@/lib/schemas/owner-settlement';
import { ownerSettlementCsv } from '@/lib/finance/owner-settlement-csv';

const ana = { ownerId: 'o1', ownerName: 'Ana' };
const bruno = { ownerId: 'o2', ownerName: 'Bruno' };

describe('buildOwnerSettlements', () => {
  it('groups by owner and deducts commission on income', () => {
    const settlements = buildOwnerSettlements(
      [
        { ...bruno, commissionPct: '8.00', propertyId: 'p2', propertyName: 'Torre', currency: 'USD', total: 500 },
        { ...ana, commissionPct: '10.00', propertyId: 'p1', propertyName: 'Casa', currency: 'PEN', total: 1000 },
      ],
      [{ ...ana, commissionPct: '10.00', propertyId: 'p1', propertyName: 'Casa', total: 150.5 }],
    );

    expect(settlements.map((s) => s.ownerName)).toEqual(['Ana', 'Bruno']);
    expect(settlements[0].lines).toEqual([
      { propertyId: 'p1', propertyName: 'Casa', currency: 'PEN', commissionPct: 10, income: 1000, expenses: 150.5, commission: 100, net: 749.5 },
    ]);
    expect(settlements[1].totals).toEqual({ USD: { income: 500, expenses: 0, commission: 40, net: 460 } });
  });

  it('keeps expense-only properties with zero commission', () => {
    const [only] = buildOwnerSettlements([], [{ ...ana, commissionPct: '10.00', propertyId: 'p1', propertyName: 'Casa', total: 80 }]);
    expect(only.totals).toEqual({ PEN: { income: 0, expenses: 80, commission: 0, net: -80 } });
  });

  it('writes a CSV with per-owner totals', () => {
    const csv = ownerSettlementCsv(buildOwnerSettlements(
      [{ ...ana, commissionPct: '10.00', propertyId: 'p1', propertyName: 'Casa', currency: 'PEN', total: 1000 }],
      [],
    ));
    expect(csv).toContain('Ana,Casa,PEN,1000.00,0.00,10.00,100.00,900.00');
    expect(csv).toContain('Ana,TOTAL,PEN,1000.00,0.00,,100.00,900.00');
  });
});

describe('owner settlement schemas', () => {
  it('validates month and commission', () => {
    expect(SettlementQuerySchema.parse({ month: '2026-02', owner_id: '' })).toEqual({ month: '2026-02', owner_id: undefined });
    expect(SettlementQuerySchema.safeParse({ month: '2026-13' }).success).toBe(false);
    expect(PropertyOwnerTermsSchema.parse({ property_id: 'p', owner_id: 'o', commission_pct: '7.5' }).commission_pct).toBe('7.50');
    expect(PropertyOwnerTermsSchema.safeParse({ property_id: 'p', owner_id: 'o', commission_pct: '101' }).success).toBe(false);
  });
});
