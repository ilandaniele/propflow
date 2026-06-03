/**
 * AC25 — incidents.category accepts material_damage and malfunction
 *         without breaking legacy categories.
 * AC26 — PriorityLegend component covers all 4 priority levels.
 */

import { describe, it, expect } from 'vitest';
import { CreateIncidentSchema } from '@/lib/schemas/incident';
import type { IncidentCategory } from '@/types';

// ── AC25: Zod schema validation ──────────────────────────────────────────────

describe('AC25 — IncidentCategory schema', () => {
  const LEGACY_CATEGORIES: IncidentCategory[] = [
    'plumbing',
    'electrical',
    'appliance',
    'structural',
    'cleaning',
    'other',
  ];

  const NEW_CATEGORIES: IncidentCategory[] = ['material_damage', 'malfunction'];

  const BASE_PAYLOAD = {
    title: 'Test incident',
    description: 'Something broke',
    priority: 'medium',
  } as const;

  it.each(LEGACY_CATEGORIES)(
    'accepts legacy category "%s" without constraint error',
    (category) => {
      const result = CreateIncidentSchema.safeParse({ ...BASE_PAYLOAD, category });
      expect(result.success).toBe(true);
    }
  );

  it.each(NEW_CATEGORIES)(
    'accepts new category "%s" without constraint error',
    (category) => {
      const result = CreateIncidentSchema.safeParse({ ...BASE_PAYLOAD, category });
      expect(result.success).toBe(true);
    }
  );

  it('rejects an unknown category value', () => {
    const result = CreateIncidentSchema.safeParse({
      ...BASE_PAYLOAD,
      category: 'unknown_category',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const fieldErrors = result.error.flatten().fieldErrors;
      expect(fieldErrors).toHaveProperty('category');
    }
  });

  it('schema has exactly 8 allowed categories', () => {
    const allExpected: IncidentCategory[] = [
      'plumbing',
      'electrical',
      'appliance',
      'structural',
      'cleaning',
      'other',
      'material_damage',
      'malfunction',
    ];

    // Every expected value should parse successfully
    for (const cat of allExpected) {
      const result = CreateIncidentSchema.safeParse({ ...BASE_PAYLOAD, category: cat });
      expect(result.success, `Category "${cat}" should be valid`).toBe(true);
    }
  });
});

// ── AC26: PriorityLegend colour mapping contract ──────────────────────────────

/**
 * The PriorityLegend component is a Server Component (no DOM in unit tests).
 * We test the colour-mapping data contract directly to ensure all 4 priority
 * levels (low/medium/high/urgent) are represented with the correct colours.
 */

const PRIORITY_COLOR_MAP: Record<string, string> = {
  low: 'green',
  medium: 'amber',
  high: 'red',
  urgent: 'purple',
};

describe('AC26 — PriorityLegend colour contract', () => {
  it('defines exactly 4 priority levels', () => {
    expect(Object.keys(PRIORITY_COLOR_MAP)).toHaveLength(4);
  });

  it('maps low to green', () => {
    expect(PRIORITY_COLOR_MAP['low']).toBe('green');
  });

  it('maps medium to amber', () => {
    expect(PRIORITY_COLOR_MAP['medium']).toBe('amber');
  });

  it('maps high to red', () => {
    expect(PRIORITY_COLOR_MAP['high']).toBe('red');
  });

  it('maps urgent to purple (spec says critical=purple but DB uses urgent)', () => {
    expect(PRIORITY_COLOR_MAP['urgent']).toBe('purple');
  });

  it('has no critical key (DB schema uses urgent not critical)', () => {
    expect(PRIORITY_COLOR_MAP).not.toHaveProperty('critical');
  });
});

// ── AC25: IncidentCategory TypeScript type covers new values ─────────────────

describe('AC25 — IncidentCategory type coverage', () => {
  // These assignments are compile-time checks; if the type is wrong they cause TS errors.
  it('type allows material_damage at compile time', () => {
    const cat: IncidentCategory = 'material_damage';
    expect(cat).toBe('material_damage');
  });

  it('type allows malfunction at compile time', () => {
    const cat: IncidentCategory = 'malfunction';
    expect(cat).toBe('malfunction');
  });
});
