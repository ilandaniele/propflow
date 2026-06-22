/**
 * GET /api/admin/integrations/airtable/status
 *
 * Returns Airtable connectivity + tenant sync stats + recent logs.
 * Auth: require admin session.
 */

export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { tenants, airtableSyncLogs } from '@/lib/db/schema';
import { eq, desc } from 'drizzle-orm';

const AIRTABLE_API_BASE = 'https://api.airtable.com/v0';

const KNOWN_TABLE_VARS = [
  'AIRTABLE_TABLE_RESIDENTES',
  'AIRTABLE_TABLE_PROPIEDADES',
  'AIRTABLE_TABLE_PAGOS',
  'AIRTABLE_TABLE_HISTORIAL',
  'AIRTABLE_TABLE_PORTAFOLIO',
  'AIRTABLE_TABLE_RESPONSABLES',
  'AIRTABLE_TABLE_PAGO_SERVICIOS',
  'AIRTABLE_TABLE_MANTENIMIENTO',
] as const;

export async function GET(_request: NextRequest): Promise<NextResponse> {
  let ctx;
  try { ctx = await requireAdmin(); } catch {
    return NextResponse.json(
      { error: { code: 'UNAUTHORIZED', message: 'Admin access required.' } },
      { status: 401 }
    );
  }

  const pat      = process.env['AIRTABLE_PAT'];
  const baseId   = process.env['AIRTABLE_BASE_ID'];
  const baseName = process.env['AIRTABLE_BASE_NAME'] ?? null;

  // Ping Airtable connectivity using any configured table
  let connectivity: { connected: boolean; latency_ms: number | null; error?: string } = {
    connected: false,
    latency_ms: null,
  };

  if (pat && baseId) {
    const probeTable = process.env['AIRTABLE_TABLE_RESIDENTES']
      || process.env['AIRTABLE_TABLE_PROPIEDADES']
      || null;

    if (probeTable) {
      const t0 = Date.now();
      try {
        const res = await fetch(
          `${AIRTABLE_API_BASE}/${baseId}/${encodeURIComponent(probeTable)}?maxRecords=1`,
          {
            headers: { Authorization: `Bearer ${pat}` },
            cache: 'no-store',
            signal: AbortSignal.timeout(5000),
          }
        );
        connectivity = {
          connected: res.ok,
          latency_ms: Date.now() - t0,
          ...(res.ok ? {} : { error: `HTTP ${res.status}` }),
        };
      } catch (err) {
        connectivity = {
          connected: false,
          latency_ms: Date.now() - t0,
          error: err instanceof Error ? err.name : 'NetworkError',
        };
      }
    } else {
      connectivity = { connected: false, latency_ms: null, error: 'No table env vars configured' };
    }
  } else {
    connectivity = { connected: false, latency_ms: null, error: 'AIRTABLE_PAT or AIRTABLE_BASE_ID not set' };
  }

  // Tenant sync stats by sync_status — Drizzle (AC1, AC8: org scoped)
  const syncStatsRaw = await db
    .select({ syncStatus: tenants.syncStatus })
    .from(tenants)
    .where(eq(tenants.orgId, ctx.orgId));

  const syncStats: Record<string, number> = {
    synced: 0,
    pending: 0,
    failed: 0,
    needs_review: 0,
  };
  for (const row of syncStatsRaw) {
    const s = row.syncStatus ?? 'pending';
    syncStats[s] = (syncStats[s] ?? 0) + 1;
  }

  // Recent sync logs — Drizzle (AC1, AC8: org scoped)
  const recentLogs = await db
    .select({
      id:              airtableSyncLogs.id,
      tableName:       airtableSyncLogs.tableName,
      status:          airtableSyncLogs.status,
      recordsUpserted: airtableSyncLogs.recordsUpserted,
      errorMessage:    airtableSyncLogs.errorMessage,
      startedAt:       airtableSyncLogs.startedAt,
      completedAt:     airtableSyncLogs.completedAt,
    })
    .from(airtableSyncLogs)
    .where(eq(airtableSyncLogs.orgId, ctx.orgId))
    .orderBy(desc(airtableSyncLogs.startedAt))
    .limit(5);

  // Env var checklist (names only — never return values or PAT)
  const envVarStatus = KNOWN_TABLE_VARS.map(varName => ({
    name: varName,
    configured: !!(process.env[varName]),
  }));

  return NextResponse.json({
    base_id:           baseId ? `...${baseId.slice(-6)}` : null,
    base_name:         baseName,
    connectivity,
    tenant_sync_stats: syncStats,
    recent_sync_logs:  recentLogs.map(l => ({
      id:               l.id,
      table_name:       l.tableName,
      status:           l.status,
      records_upserted: l.recordsUpserted,
      error_message:    l.errorMessage,
      started_at:       l.startedAt,
      completed_at:     l.completedAt,
    })),
    env_vars:          envVarStatus,
    checked_at:        new Date().toISOString(),
  });
}
