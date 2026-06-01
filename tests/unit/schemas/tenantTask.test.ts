import { describe, it, expect } from 'vitest';
import {
  CreateTenantTaskSchema,
  UpdateTenantTaskSchema,
  CancelTenantTaskSchema,
  TASK_TYPES,
  TASK_STATUSES,
} from '@/lib/schemas/tenantTask';

describe('CreateTenantTaskSchema', () => {
  const VALID_TASK = {
    tenant_id: '00000000-0000-0000-0000-000000000001',
    task_type: 'maintenance' as const,
    title: 'Fix broken pipe',
    due_at: '2026-07-01T09:00:00.000Z',
  };

  it('accepts a valid create payload', () => {
    const result = CreateTenantTaskSchema.safeParse(VALID_TASK);
    expect(result.success).toBe(true);
  });

  it('accepts optional description', () => {
    const result = CreateTenantTaskSchema.safeParse({
      ...VALID_TASK,
      description: 'Fix the pipe in unit 2B bathroom',
    });
    expect(result.success).toBe(true);
  });

  it('accepts null description', () => {
    const result = CreateTenantTaskSchema.safeParse({ ...VALID_TASK, description: null });
    expect(result.success).toBe(true);
  });

  it('rejects invalid tenant_id (not UUID)', () => {
    const result = CreateTenantTaskSchema.safeParse({ ...VALID_TASK, tenant_id: 'bad-uuid' });
    expect(result.success).toBe(false);
  });

  it('rejects empty title', () => {
    const result = CreateTenantTaskSchema.safeParse({ ...VALID_TASK, title: '' });
    expect(result.success).toBe(false);
  });

  it('rejects title exceeding 200 chars', () => {
    const result = CreateTenantTaskSchema.safeParse({ ...VALID_TASK, title: 'a'.repeat(201) });
    expect(result.success).toBe(false);
  });

  it('rejects description exceeding 2000 chars', () => {
    const result = CreateTenantTaskSchema.safeParse({
      ...VALID_TASK,
      description: 'a'.repeat(2001),
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid due_at (not ISO8601)', () => {
    const result = CreateTenantTaskSchema.safeParse({ ...VALID_TASK, due_at: '2026-07-01' });
    expect(result.success).toBe(false);
  });

  it('rejects invalid task_type', () => {
    const result = CreateTenantTaskSchema.safeParse({ ...VALID_TASK, task_type: 'renovation' });
    expect(result.success).toBe(false);
  });

  it('accepts all valid task types', () => {
    for (const task_type of TASK_TYPES) {
      const result = CreateTenantTaskSchema.safeParse({ ...VALID_TASK, task_type });
      expect(result.success).toBe(true);
    }
  });
});

describe('UpdateTenantTaskSchema', () => {
  it('accepts id only (all other fields optional)', () => {
    const result = UpdateTenantTaskSchema.safeParse({
      id: '00000000-0000-0000-0000-000000000001',
    });
    expect(result.success).toBe(true);
  });

  it('accepts status update', () => {
    const result = UpdateTenantTaskSchema.safeParse({
      id: '00000000-0000-0000-0000-000000000001',
      status: 'in_progress',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid status', () => {
    const result = UpdateTenantTaskSchema.safeParse({
      id: '00000000-0000-0000-0000-000000000001',
      status: 'invalid_status',
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-UUID id', () => {
    const result = UpdateTenantTaskSchema.safeParse({ id: 'not-a-uuid' });
    expect(result.success).toBe(false);
  });

  it('accepts valid due_at update', () => {
    const result = UpdateTenantTaskSchema.safeParse({
      id: '00000000-0000-0000-0000-000000000001',
      due_at: '2026-08-15T12:00:00.000Z',
    });
    expect(result.success).toBe(true);
  });
});

describe('CancelTenantTaskSchema', () => {
  it('accepts a valid UUID id', () => {
    const result = CancelTenantTaskSchema.safeParse({ id: '00000000-0000-0000-0000-000000000001' });
    expect(result.success).toBe(true);
  });

  it('rejects non-UUID id', () => {
    const result = CancelTenantTaskSchema.safeParse({ id: 'bad' });
    expect(result.success).toBe(false);
  });
});

describe('Constants', () => {
  it('TASK_TYPES includes all expected types', () => {
    for (const type of ['maintenance', 'document', 'inspection', 'cleanup', 'custom']) {
      expect(TASK_TYPES).toContain(type);
    }
  });

  it('TASK_STATUSES includes all expected statuses', () => {
    const expected = ['pending', 'in_progress', 'proof_pending_review', 'completed', 'expired', 'cancelled'];
    for (const status of expected) {
      expect(TASK_STATUSES).toContain(status);
    }
  });
});
