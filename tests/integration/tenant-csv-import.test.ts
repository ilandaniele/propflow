/**
 * tests/integration/tenant-csv-import.test.ts
 *
 * Tests for POST /api/admin/tenants/import (Drizzle version).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── Mock state ─────────────────────────────────────────────────────────────────

const ORG_ID  = 'org-tenants-test-001';
const USER_ID = 'user-tenants-test-001';
const LOG_ID  = 'log-tenants-test-001';

interface TenantRecord {
  id: string;
  email: string | null;
  portalAccess?: string;
  airtableExternalId: string | null;
}

const state = {
  requireAdminError: false,
  // In-memory tenant store keyed by id
  tenants: {} as Record<string, TenantRecord>,
  nextTenantId: 1,
};

vi.mock('@/lib/auth/guards', () => ({
  requireAdmin: vi.fn().mockImplementation(async () => {
    if (state.requireAdminError) throw new Error('UNAUTHORIZED');
    return { userId: USER_ID, orgId: ORG_ID, role: 'admin', profile: {} };
  }),
}));

vi.mock('@/lib/airtable/write', () => ({
  upsertAirtableResidente: vi.fn().mockResolvedValue({
    airtableRecordId: 'recAIRTABLE001',
    created: true,
  }),
}));

// ---------------------------------------------------------------------------
// Mock @/lib/db — Drizzle
// ---------------------------------------------------------------------------

vi.mock('@/lib/db', () => {
  function getTableName(tableRef: unknown): string {
    if (!tableRef || typeof tableRef !== 'object') return '';
    const syms = Object.getOwnPropertySymbols(tableRef as object);
    const nameSym = syms.find(s => s.toString() === 'Symbol(drizzle:Name)');
    return nameSym ? String((tableRef as Record<symbol, unknown>)[nameSym]) : '';
  }

  return {
    db: {
      select: vi.fn(() => {
        let tableName = '';
        const chain = {
          from: vi.fn((tableRef: unknown) => {
            tableName = getTableName(tableRef);
            return chain;
          }),
          where: vi.fn(async () => {
            if (tableName === 'tenants') {
              // Return existing tenants
              return Object.values(state.tenants).map(t => ({
                id: t.id,
                email: t.email,
                airtableExternalId: t.airtableExternalId,
                externalTenantId: null,
              }));
            }
            return [];
          }),
        };
        return chain;
      }),

      insert: vi.fn((tableRef: unknown) => {
        const table = getTableName(tableRef);
        return {
          values: vi.fn((payload: unknown) => ({
            returning: vi.fn(async () => {
              if (table === 'tenants') {
                const p = payload as { email?: string | null; portalAccess?: string };
                const id = `tenant-new-${state.nextTenantId++}`;
                state.tenants[id] = {
                  id,
                  email: p.email ?? null,
                  portalAccess: p.portalAccess,
                  airtableExternalId: null,
                };
                return [{ id }];
              }
              if (table === 'import_logs') {
                return [{ id: LOG_ID }];
              }
              return [];
            }),
          })),
        };
      }),

      update: vi.fn((tableRef: unknown) => {
        const table = getTableName(tableRef);
        return {
          set: vi.fn((data: unknown) => ({
            where: vi.fn(async () => {
              if (table === 'tenants') {
                // Update in-memory store (find by checking state)
                const d = data as Record<string, unknown>;
                for (const tenant of Object.values(state.tenants)) {
                  // Apply updates
                  Object.assign(tenant, d);
                }
              }
              return [];
            }),
          })),
        };
      }),

      // Promise.all path — select with then()
      execute: vi.fn(async () => []),
    },
  };
});

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
    state.nextTenantId = 1;
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
    expect(newTenant?.portalAccess).toBe('not_invited');
  });

  // ── Same row imported again → updated, not duplicated ───────────────────────

  it('updates (not duplicates) tenant on second import with same email', async () => {
    // Pre-seed existing tenant
    state.tenants['tenant-existing-001'] = {
      id: 'tenant-existing-001',
      email: 'existing@test.com',
      portalAccess: 'not_invited',
      airtableExternalId: null,
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
    state.requireAdminError = true;
    const file = buildCsvFile(HEADERS, [
      ['Ana', 'López', 'ana@test.com', '111222333', 'active'],
    ]);
    const res = await POST(makeRequest(file));
    expect([401, 403]).toContain(res.status);
  });
});
