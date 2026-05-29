import { describe, it, expect } from 'vitest';
import { interpolateTemplate, ALLOWED_VARIABLES } from '@/lib/contracts/pdf.tsx';

describe('interpolateTemplate', () => {
  it('replaces allowed variables', () => {
    const body = 'This lease is between {{org_name}} and {{tenant_name}} for unit {{unit_label}}.';
    const result = interpolateTemplate(body, {
      org_name: 'Acme Properties',
      tenant_name: 'Jane Doe',
      unit_label: '1A',
    });
    expect(result).toBe('This lease is between Acme Properties and Jane Doe for unit 1A.');
  });

  it('leaves unknown variables as-is (no injection)', () => {
    const body = 'Hello {{unknown_var}} and {{exec(cmd)}} and {{__proto__}}';
    const result = interpolateTemplate(body, {});
    expect(result).toBe('Hello {{unknown_var}} and {{exec(cmd)}} and {{__proto__}}');
  });

  it('replaces multiple occurrences of the same variable', () => {
    const body = '{{tenant_name}} signed. Tenant: {{tenant_name}}';
    const result = interpolateTemplate(body, { tenant_name: 'Bob' });
    expect(result).toBe('Bob signed. Tenant: Bob');
  });

  it('uses placeholder when variable is not provided', () => {
    const body = 'Start: {{start_date}}';
    const result = interpolateTemplate(body, {});
    expect(result).toBe('Start: {{start_date}}');
  });

  it('only allows explicitly listed variables', () => {
    // Every variable in ALLOWED_VARIABLES should be substitutable
    const body = ALLOWED_VARIABLES.map(v => `{{${v}}}`).join(' ');
    const vars = Object.fromEntries(ALLOWED_VARIABLES.map(v => [v, `VALUE_${v}`]));
    const result = interpolateTemplate(body, vars as Parameters<typeof interpolateTemplate>[1]);
    for (const v of ALLOWED_VARIABLES) {
      expect(result).toContain(`VALUE_${v}`);
      expect(result).not.toContain(`{{${v}}}`);
    }
  });

  it('handles empty template body', () => {
    expect(interpolateTemplate('', { org_name: 'X' })).toBe('');
  });
});
