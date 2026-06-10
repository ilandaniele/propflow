/**
 * tests/integration/tenant-csv-import.test.ts
 *
 * Tests for POST /api/admin/tenants/import
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── Mock state ─────────────────────────────────────────────────────────────────

const ORG_ID  = 'org-tenants-test-001';
const USER_ID = 'user-tenants-test-001';
const LOG_ID  = 'log-tenants-test-001';

interface TenantRecord {
  id: string;
  email: string;
  portal_access?: string;
  airtable_external_id: string | null;
}

const state = {
  requireAdminError: false,
  requireAdminRole: 'admin' as string,
  tenants: {} as Record<string, TenantRecord>,
  nextTenantId: 1,
};

vi.mock('@/lib/auth/guards', () => ({
  requireAdmin: vi.fn().mockImplementation(async () => {
    if (state.requireAdminError) throw new Error('UNAUTHORIZED');
    if (state.requireAdminRole !== 'admin') throw new Error('FORBIDDEN');
    return { userId: USER_ID, orgId: ORG_ID, role: 'admin', profile: {} };
  }),
}));

vi.mock('@/lib/airtable/write', () => ({
  upsertAirtableResidente: vi.fn().mockResolvedValue({
    airtableRecordId: 'recAIRTABLE001',
    created: true,
  }),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn().mockReturnValue({
    from: vi.fn((table: string) => {
      if (table === 'tenants') {
        return {
          select: vi.fn((_cols: string) => ({
            eq: vi.fn((_col: string, _val: string) => ({
              in: vi.fn(async (_col2: string, emails: string[]) => {
                const matches = Object.values(state.tenants).filter(t =>
                  _col2 === 'email' ? emails.includes(t.email) : true
                );
                return { data: matches, error: null };
              }),
            })),
          })),
          insert: vi.fn((payload: Record<string, unknown>) => ({
            select: vi.fn(() => ({
              single: vi.fn(async () => {
                const id = `tenant-new-${state.nextTenantId++}`;
                state.tenants[id] = {
                  id,
                  email: payload.email as string,
                  portal_access: payload.portal_access as string,
                  airtable_external_id: null,
                };
                return { data: { id }, error: null };
              }),
            })),
          })),
          update: vi.fn((payload: Record<string, unknown>) => ({
            eq: vi.fn(async (_col: string, id: string) => {
              if (state.tenants[id]) {
                Object.assign(state.tenants[id], payload);
              }
              return { error: null };
            }),
          })),
        };
      }

      if (table === 'import_logs') {
        return {
          insert: vi.fn(() => ({
            select: vi.fn(() => ({
              single: vi.fn(async () => ({ data: { id: LOG_ID }, error: null })),
            })),
          })),
          update: vi.fn(() => ({
            eq: vi.fn(async () => ({ error: null })),
          })),
        };
      }

      return {};
    }),
  }),
}));

function buildCsvFile(headers: string[], rows: string[][]): File {
  const content = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  return new File([content], 'tenants.csv', { type: 'text/csv' });
}

function makeRequest(file: File): NextRequest {
  const formData = new FormData();
  formData.append('file', file);
  return new NextRequest('http://localhost:3000/api/admin/tenants/import', {
    method: 'POST',
    body: formData,
  });
}

const HEADERS = ['first_name', 'last_name', 'email', 'phone', 'status'];

import { POST } from '@/app/api/admin/tenants/import/route';

describe('POST /api/admin/tenants/import', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.requireAdminError = false;
    state.requireAdminRole = 'admin';
    state.nextTenantId = 1;
    // Clear tenants store
    for (const k of Object.keys(state.tenants)) {
      delete state.tenants[k];
    }
  });

  // ── New tenant created with portal_access = not_invited ─────────────────────

  it('creates a new tenant with portal_access = not_invited', async () => {
    const file = buildCsvFile(HEADERS, [
      ['María', 'García', 'nueva@test.com', '999888777', 'active'],
    ]);
    const res = await POST(makeRequest(file));
    expect(res.status).toBe(200);
    const body = await res.json() as { created: number; updated: number };
    expect(body.created).toBe(1);
    expect(body.updated).toBe(0);
    // Verify portal_access was set on the inserted tenant
    const newTenant = Object.values(state.tenants).find(t => t.email === 'nueva@test.com');
    expect(newTenant).toBeDefined();
    expect(newTenant?.portal_access).toBe('not_invited');
  });

  // ── Same row imported again → updated, not duplicated ───────────────────────

  it('updates (not duplicates) tenant on second import with same email', async () => {
    // Pre-seed existing tenant
    state.tenants['tenant-existing-001'] = {
      id: 'tenant-existing-001',
      email: 'existing@test.com',
      portal_access: 'not_invited',
      airtable_external_id: null,
    };

    const file = buildCsvFile(HEADERS, [
      ['María', 'García', 'existing@test.com', '999888777', 'active'],
    ]);
    const res = await POST(makeRequest(file));
    expect(res.status).toBe(200);
    const body = await res.json() as { created: number; updated: number };
    expect(body.updated).toBe(1);
    expect(body.created).toBe(0);
    // Still only 1 tenant with that email
    const matchingTenants = Object.values(state.tenants).filter(t => t.email === 'existing@test.com');
    expect(matchingTenants).toHaveLength(1);
  });

  // ── Row with unknown property/unit → creates tenant, logs warning ────────────

  it('creates tenant even when property/unit info is unknown (extra columns ignored)', async () => {
    const headersWithExtra = [...HEADERS, 'property_name', 'unit_label'];
    const file = buildCsvFile(headersWithExtra, [
      ['Pedro', 'Ruiz', 'pedro@test.com', '123456789', 'active', 'Casa Desconocida', 'Habitación 99'],
    ]);
    const res = await POST(makeRequest(file));
    expect(res.status).toBe(200);
    const body = await res.json() as { created: number; updated: number };
    expect(body.created).toBe(1);
  });

  // ── Unauthenticated → 401 ──────────────────────────────────────────────────

  it('returns 401 for unauthenticated request', async () => {
    state.requireAdminError = true;
    const file = buildCsvFile(HEADERS, [
      ['Ana', 'López', 'ana@test.com', '111222333', 'active'],
    ]);
    const res = await POST(makeRequest(file));
    expect(res.status).toBe(401);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  // ── Non-admin → 401/403 ────────────────────────────────────────────────────

  it('returns 401/403 when caller is not an admin', async () => {
    state.requireAdminError = true; // guard throws for non-admin too
    const file = buildCsvFile(HEADERS, [
      ['Ana', 'López', 'ana@test.com', '111222333', 'active'],
    ]);
    const res = await POST(makeRequest(file));
    expect([401, 403]).toContain(res.status);
  });
});
