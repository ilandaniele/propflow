import { describe, it, expect } from 'vitest';
import {
  ProposeSanctionSchema,
  ApproveSanctionSchema,
  RejectSanctionSchema,
  DisputeSanctionSchema,
  SANCTION_KINDS,
  SANCTION_STATUSES,
} from '@/lib/schemas/sanction';

describe('ProposeSanctionSchema', () => {
  it('accepts a valid monetary sanction', () => {
    const result = ProposeSanctionSchema.safeParse({
      tenant_id: '00000000-0000-0000-0000-000000000001',
      kind: 'monetary',
      title: 'Late payment fee',
      reason: 'Payment was 10 days overdue.',
      amount: 150,
    });
    expect(result.success).toBe(true);
  });

  it('accepts a valid warning sanction without amount', () => {
    const result = ProposeSanctionSchema.safeParse({
      tenant_id: '00000000-0000-0000-0000-000000000001',
      kind: 'warning',
      title: 'Noise violation',
      reason: 'Loud music after 10pm.',
    });
    expect(result.success).toBe(true);
  });

  it('rejects monetary sanction without amount', () => {
    const result = ProposeSanctionSchema.safeParse({
      tenant_id: '00000000-0000-0000-0000-000000000001',
      kind: 'monetary',
      title: 'Fee',
      reason: 'Some reason',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.amount).toBeDefined();
    }
  });

  it('rejects warning sanction with amount set', () => {
    const result = ProposeSanctionSchema.safeParse({
      tenant_id: '00000000-0000-0000-0000-000000000001',
      kind: 'warning',
      title: 'Warning',
      reason: 'Some reason',
      amount: 100,
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid tenant_id (not UUID)', () => {
    const result = ProposeSanctionSchema.safeParse({
      tenant_id: 'not-a-uuid',
      kind: 'warning',
      title: 'Warning',
      reason: 'reason',
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty title', () => {
    const result = ProposeSanctionSchema.safeParse({
      tenant_id: '00000000-0000-0000-0000-000000000001',
      kind: 'warning',
      title: '',
      reason: 'reason',
    });
    expect(result.success).toBe(false);
  });

  it('rejects title exceeding 200 chars', () => {
    const result = ProposeSanctionSchema.safeParse({
      tenant_id: '00000000-0000-0000-0000-000000000001',
      kind: 'warning',
      title: 'a'.repeat(201),
      reason: 'reason',
    });
    expect(result.success).toBe(false);
  });

  it('rejects negative amount', () => {
    const result = ProposeSanctionSchema.safeParse({
      tenant_id: '00000000-0000-0000-0000-000000000001',
      kind: 'monetary',
      title: 'Fee',
      reason: 'reason',
      amount: -50,
    });
    expect(result.success).toBe(false);
  });

  it('rejects amount exceeding max 999_999', () => {
    const result = ProposeSanctionSchema.safeParse({
      tenant_id: '00000000-0000-0000-0000-000000000001',
      kind: 'monetary',
      title: 'Fee',
      reason: 'reason',
      amount: 1_000_000,
    });
    expect(result.success).toBe(false);
  });

  it('coerces amount from string to number', () => {
    const result = ProposeSanctionSchema.safeParse({
      tenant_id: '00000000-0000-0000-0000-000000000001',
      kind: 'monetary',
      title: 'Fee',
      reason: 'reason',
      amount: '200',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.amount).toBe(200);
    }
  });
});

describe('ApproveSanctionSchema', () => {
  it('accepts a valid UUID id', () => {
    const result = ApproveSanctionSchema.safeParse({ id: '00000000-0000-0000-0000-000000000001' });
    expect(result.success).toBe(true);
  });

  it('rejects non-UUID id', () => {
    const result = ApproveSanctionSchema.safeParse({ id: 'bad-id' });
    expect(result.success).toBe(false);
  });
});

describe('RejectSanctionSchema', () => {
  it('accepts id only (reason optional)', () => {
    const result = RejectSanctionSchema.safeParse({ id: '00000000-0000-0000-0000-000000000001' });
    expect(result.success).toBe(true);
  });

  it('accepts id with reason', () => {
    const result = RejectSanctionSchema.safeParse({
      id: '00000000-0000-0000-0000-000000000001',
      reason: 'Insufficient evidence',
    });
    expect(result.success).toBe(true);
  });

  it('rejects reason exceeding 500 chars', () => {
    const result = RejectSanctionSchema.safeParse({
      id: '00000000-0000-0000-0000-000000000001',
      reason: 'a'.repeat(501),
    });
    expect(result.success).toBe(false);
  });
});

describe('DisputeSanctionSchema', () => {
  it('accepts a valid dispute', () => {
    const result = DisputeSanctionSchema.safeParse({
      id: '00000000-0000-0000-0000-000000000001',
      dispute_reason: 'I have proof that this sanction is invalid.',
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty dispute_reason', () => {
    const result = DisputeSanctionSchema.safeParse({
      id: '00000000-0000-0000-0000-000000000001',
      dispute_reason: '',
    });
    expect(result.success).toBe(false);
  });

  it('rejects dispute_reason exceeding 1000 chars', () => {
    const result = DisputeSanctionSchema.safeParse({
      id: '00000000-0000-0000-0000-000000000001',
      dispute_reason: 'a'.repeat(1001),
    });
    expect(result.success).toBe(false);
  });
});

describe('Constants', () => {
  it('SANCTION_KINDS includes monetary and warning', () => {
    expect(SANCTION_KINDS).toContain('monetary');
    expect(SANCTION_KINDS).toContain('warning');
  });

  it('SANCTION_STATUSES includes all expected statuses', () => {
    for (const status of ['proposed', 'approved', 'rejected', 'disputed', 'resolved']) {
      expect(SANCTION_STATUSES).toContain(status);
    }
  });
});
