/**
 * tests/unit/ai/sanitize.test.ts
 *
 * AC31: No tenant email/phone/full_name/whatsapp_phone appears in any LLM prompt.
 * Verified by sanitization unit test.
 *
 * Coverage:
 * 1. Top-level PII key stripping (email, phone, full_name, whatsapp_phone)
 * 2. Nested PII key stripping (recursive)
 * 3. Aggregate numeric values pass through unchanged
 * 4. String values containing email/phone patterns are redacted
 * 5. Arrays are recursively sanitized
 * 6. sanitizeForLLM returns valid JSON string
 * 7. AC31 explicit test: assembled prompt with tenant data — no PII leaks
 */

import { describe, it, expect } from 'vitest';
import { sanitizeForLLM, stripPiiFields } from '@/lib/ai/sanitize';

// ---------------------------------------------------------------------------
// stripPiiFields — unit tests
// ---------------------------------------------------------------------------

describe('stripPiiFields', () => {

  // ── 1. Top-level PII key stripping ────────────────────────────────────────

  it('AC31: strips "email" key from object', () => {
    const input = { occupancyRate: 85, email: 'tenant@example.com', grossIncome: 5000 };
    const result = stripPiiFields(input) as Record<string, unknown>;
    expect(result).not.toHaveProperty('email');
    expect(result.occupancyRate).toBe(85);
    expect(result.grossIncome).toBe(5000);
  });

  it('AC31: strips "phone" key from object', () => {
    const input = { units: 10, phone: '+1-555-123-4567', netProfit: 2000 };
    const result = stripPiiFields(input) as Record<string, unknown>;
    expect(result).not.toHaveProperty('phone');
    expect(result.units).toBe(10);
    expect(result.netProfit).toBe(2000);
  });

  it('AC31: strips "full_name" key from object', () => {
    const input = { openIncidents: 3, full_name: 'John Doe', expenses: 1200 };
    const result = stripPiiFields(input) as Record<string, unknown>;
    expect(result).not.toHaveProperty('full_name');
    expect(result.openIncidents).toBe(3);
  });

  it('AC31: strips "whatsapp_phone" key from object', () => {
    const input = { occupancyRate: 90, whatsapp_phone: '+5491155556666', income: 8000 };
    const result = stripPiiFields(input) as Record<string, unknown>;
    expect(result).not.toHaveProperty('whatsapp_phone');
    expect(result.occupancyRate).toBe(90);
  });

  it('strips "name" key from object', () => {
    const input = { count: 5, name: 'Alice Smith' };
    const result = stripPiiFields(input) as Record<string, unknown>;
    expect(result).not.toHaveProperty('name');
    expect(result.count).toBe(5);
  });

  it('strips "address" key from object', () => {
    const input = { units: 20, address: '123 Main St' };
    const result = stripPiiFields(input) as Record<string, unknown>;
    expect(result).not.toHaveProperty('address');
    expect(result.units).toBe(20);
  });

  // ── 2. Aggregate numeric values pass through ───────────────────────────────

  it('passes aggregate numeric values through unchanged', () => {
    const input = {
      occupancyRate: 87,
      grossIncome: 12345.67,
      totalExpenses: 4321.50,
      trueNetProfit: 8024.17,
      openIncidentsCount: 4,
      overduePaymentsCount: 2,
      activeTenantsCount: 30,
    };
    const result = stripPiiFields(input) as typeof input;
    expect(result.occupancyRate).toBe(87);
    expect(result.grossIncome).toBe(12345.67);
    expect(result.totalExpenses).toBe(4321.50);
    expect(result.trueNetProfit).toBe(8024.17);
    expect(result.openIncidentsCount).toBe(4);
    expect(result.overduePaymentsCount).toBe(2);
    expect(result.activeTenantsCount).toBe(30);
  });

  it('passes boolean values through unchanged', () => {
    const input = { active: true, hasOverdue: false, count: 3 };
    const result = stripPiiFields(input) as typeof input;
    expect(result.active).toBe(true);
    expect(result.hasOverdue).toBe(false);
    expect(result.count).toBe(3);
  });

  // ── 3. Nested object recursive stripping ──────────────────────────────────

  it('AC31: strips PII keys from nested objects (recursive)', () => {
    const input = {
      summary: {
        totalUnits: 15,
        email: 'admin@org.com',
        performance: {
          grossIncome: 7500,
          full_name: 'Nested Name',
          netProfit: 5000,
        },
      },
    };
    const result = stripPiiFields(input) as {
      summary: {
        totalUnits: number;
        performance: { grossIncome: number; netProfit: number };
      };
    };
    expect(result.summary).not.toHaveProperty('email');
    expect(result.summary.totalUnits).toBe(15);
    expect(result.summary.performance).not.toHaveProperty('full_name');
    expect(result.summary.performance.grossIncome).toBe(7500);
    expect(result.summary.performance.netProfit).toBe(5000);
  });

  // ── 4. Arrays are recursively sanitized ───────────────────────────────────

  it('strips PII keys from objects inside arrays', () => {
    const input = [
      { unitId: 'u1', revenue: 1000, tenant_email: 'a@b.com' },
      { unitId: 'u2', revenue: 1200, phone: '+5500000000' },
    ];
    const result = stripPiiFields(input) as Array<Record<string, unknown>>;
    expect(result[0]).not.toHaveProperty('tenant_email');
    expect(result[0].unitId).toBe('u1');
    expect(result[0].revenue).toBe(1000);
    expect(result[1]).not.toHaveProperty('phone');
    expect(result[1].revenue).toBe(1200);
  });

  // ── 5. String values with email/phone patterns are redacted ───────────────

  it('redacts email pattern within retained string values', () => {
    const input = { notes: 'Contact admin@example.com for details', count: 5 };
    const result = stripPiiFields(input) as { notes: string; count: number };
    expect(result.notes).toContain('[EMAIL]');
    expect(result.notes).not.toContain('admin@example.com');
    expect(result.count).toBe(5);
  });

  it('redacts phone pattern within retained string values', () => {
    const input = { description: 'Call +1-800-555-1234 for info', amount: 100 };
    const result = stripPiiFields(input) as { description: string; amount: number };
    expect(result.description).toContain('[PHONE]');
    expect(result.description).not.toContain('555-1234');
    expect(result.amount).toBe(100);
  });

  // ── 6. Null / undefined handling ──────────────────────────────────────────

  it('returns null for null input', () => {
    expect(stripPiiFields(null)).toBeNull();
  });

  it('returns undefined for undefined input', () => {
    expect(stripPiiFields(undefined)).toBeUndefined();
  });

  it('returns primitive numbers unchanged', () => {
    expect(stripPiiFields(42)).toBe(42);
    expect(stripPiiFields(0)).toBe(0);
  });

  it('returns primitive booleans unchanged', () => {
    expect(stripPiiFields(true)).toBe(true);
    expect(stripPiiFields(false)).toBe(false);
  });

  // ── 7. Case-insensitive key matching ──────────────────────────────────────

  it('strips keys case-insensitively (EMAIL, Phone, FULL_NAME)', () => {
    const input = { count: 3, EMAIL: 'x@x.com', Phone: '1234567890', FULL_NAME: 'Bob' };
    const result = stripPiiFields(input) as Record<string, unknown>;
    expect(result).not.toHaveProperty('EMAIL');
    expect(result).not.toHaveProperty('Phone');
    expect(result).not.toHaveProperty('FULL_NAME');
    expect(result.count).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// sanitizeForLLM — JSON output
// ---------------------------------------------------------------------------

describe('sanitizeForLLM', () => {

  it('returns a valid JSON string', () => {
    const input = { occupancyRate: 85, grossIncome: 5000, email: 'x@x.com' };
    const result = sanitizeForLLM(input);
    expect(() => JSON.parse(result)).not.toThrow();
  });

  it('JSON output does not contain stripped PII keys', () => {
    const input = {
      period: '2026-06',
      occupancyRate: 90,
      email: 'tenant@example.com',
      phone: '+5491155556666',
      full_name: 'Alice',
      whatsapp_phone: '+5491155557777',
      grossIncome: 8000,
    };
    const result = sanitizeForLLM(input);
    const parsed = JSON.parse(result);
    expect(parsed).not.toHaveProperty('email');
    expect(parsed).not.toHaveProperty('phone');
    expect(parsed).not.toHaveProperty('full_name');
    expect(parsed).not.toHaveProperty('whatsapp_phone');
    expect(parsed.occupancyRate).toBe(90);
    expect(parsed.grossIncome).toBe(8000);
    // period passes through (not a PII key)
    expect(parsed.period).toBe('2026-06');
  });

  it('serializes numeric aggregates correctly', () => {
    const kpis = {
      occupancyRate: 87,
      grossIncome: 12345.67,
      totalExpenses: 4321.50,
      trueNetProfit: 8024.17,
      openIncidentsCount: 4,
      overduePaymentsCount: 2,
      activeTenantsCount: 30,
    };
    const result = sanitizeForLLM(kpis);
    const parsed = JSON.parse(result);
    expect(parsed.occupancyRate).toBe(87);
    expect(parsed.grossIncome).toBe(12345.67);
    expect(parsed.trueNetProfit).toBe(8024.17);
  });

  // ── AC31: explicit acceptance criterion test ───────────────────────────────

  it('AC31: assembled prompt string contains no tenant email, phone, full_name, or whatsapp_phone', () => {
    // Simulate a tenant row as it might look coming from a Supabase query
    const tenantRow = {
      id: 'tenant-uuid-001',
      org_id: 'org-uuid-001',
      full_name: 'Maria García',
      email: 'maria.garcia@example.com',
      phone: '+34 612 345 678',
      whatsapp_phone: '+34612345678',
      unit_id: 'unit-uuid-001',
      reliability_score: 95,
      // Aggregate fields that SHOULD appear
      balance_overdue: 150.00,
    };

    // Also simulate an aggregate KPI object (what actually goes in the prompt)
    const kpiData = {
      period: '2026-06',
      occupancyRate: 88,
      activeTenantsCount: 25,
      grossIncome: 18500.00,
      totalExpenses: 6200.00,
      trueNetProfit: 12300.00,
      openIncidentsCount: 3,
      overduePaymentsCount: 2,
      // Accidentally included tenant row (represents a miscoded context build)
      sampleTenant: tenantRow,
    };

    const sanitizedJson = sanitizeForLLM(kpiData);

    // The final prompt that would be sent to the LLM
    const assembledPrompt = `Generate executive brief for period 2026-06 with KPIs: ${sanitizedJson}`;

    // AC31 assertion: no PII should appear in the assembled prompt
    expect(assembledPrompt).not.toContain('maria.garcia@example.com');
    expect(assembledPrompt).not.toContain('+34 612 345 678');
    expect(assembledPrompt).not.toContain('+34612345678');
    expect(assembledPrompt).not.toContain('Maria García');
    expect(assembledPrompt).not.toContain('Maria Garcia');

    // Aggregates should still be present
    expect(assembledPrompt).toContain('88');        // occupancyRate
    expect(assembledPrompt).toContain('18500');     // grossIncome
    expect(assembledPrompt).toContain('12300');     // trueNetProfit
    expect(assembledPrompt).toContain('2026-06');   // period
  });

  it('AC31: nested tenant arrays in context object — no PII leaks into prompt', () => {
    const contextWithTenants = {
      period: '2026-06',
      aggregates: {
        totalUnits: 20,
        occupiedUnits: 17,
        grossIncome: 8000,
        expenses: 3000,
      },
      // This should never happen in production code but we verify the sanitizer
      // handles it defensively:
      tenants: [
        { id: 't1', email: 'a@example.com', full_name: 'Alice', balance: 500 },
        { id: 't2', phone: '+1-555-0100', whatsapp_phone: '+15550100', balance: 0 },
      ],
    };

    const sanitizedJson = sanitizeForLLM(contextWithTenants);
    const parsed = JSON.parse(sanitizedJson) as {
      tenants: Array<Record<string, unknown>>;
      aggregates: Record<string, unknown>;
    };

    // Tenant array exists but PII keys are stripped
    expect(parsed.tenants[0]).not.toHaveProperty('email');
    expect(parsed.tenants[0]).not.toHaveProperty('full_name');
    expect(parsed.tenants[1]).not.toHaveProperty('phone');
    expect(parsed.tenants[1]).not.toHaveProperty('whatsapp_phone');

    // Non-PII fields remain
    expect(parsed.tenants[0].id).toBe('t1');
    expect(parsed.tenants[0].balance).toBe(500);

    // Aggregates untouched
    expect(parsed.aggregates.grossIncome).toBe(8000);

    // Raw JSON string check
    expect(sanitizedJson).not.toContain('a@example.com');
    expect(sanitizedJson).not.toContain('Alice');
    expect(sanitizedJson).not.toContain('+1-555-0100');
    expect(sanitizedJson).not.toContain('+15550100');
  });
});
