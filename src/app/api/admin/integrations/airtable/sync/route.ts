/**
 * POST /api/admin/integrations/airtable/sync
 *
 * Triggers an on-demand Airtable sync for the admin's org only.
 * Auth: require admin session.
 *
 * TODO(W6): syncEntityTable still accepts SupabaseClient — adminClient is kept
 * here until W6 migrates that lib function to Drizzle.
 */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/guards';
// TODO(W6): remove createAdminClient once syncEntityTable uses Drizzle
import { createAdminClient } from '@/lib/supabase/admin';
import { syncEntityTable, type EntityName, type IdMap } from '@/lib/airtable/sync-entities';
import { resolveEntityTableEnvKey } from '@/lib/airtable/env';
import { getAirtableClient } from '@/lib/airtable/client';

const ENTITY_SYNC_TARGETS: Array<{ tableEnvKey: string; entity: EntityName }> = [
  { tableEnvKey: 'AIRTABLE_TABLE_PROPIEDADES',    entity: 'properties' },
  { tableEnvKey: 'AIRTABLE_TABLE_RESPONSABLES',   entity: 'responsables' },
  { tableEnvKey: 'AIRTABLE_TABLE_PORTAFOLIO',     entity: 'units' },
  { tableEnvKey: 'AIRTABLE_TABLE_PAGO_SERVICIOS', entity: 'service_payments' },
  { tableEnvKey: 'AIRTABLE_TABLE_MANTENIMIENTO',  entity: 'incidents' },
  { tableEnvKey: 'AIRTABLE_TABLE_RESIDENTES',     entity: 'tenants' },
  { tableEnvKey: 'AIRTABLE_TABLE_HISTORIAL',      entity: 'contracts' },
  { tableEnvKey: 'AIRTABLE_TABLE_PAGOS',          entity: 'payments' },
  { tableEnvKey: 'AIRTABLE_TABLE_ADICIONALES',    entity: 'additional_charges' },
  { tableEnvKey: 'AIRTABLE_TABLE_EECC',           entity: 'account_statements' },
  { tableEnvKey: 'AIRTABLE_TABLE_IMPUESTOS',      entity: 'tax_receipts' },
  { tableEnvKey: 'AIRTABLE_TABLE_FEEDBACK',       entity: 'tenant_feedback' },
];

export async function POST(_request: NextRequest): Promise<NextResponse> {
  let ctx;
  try { ctx = await requireAdmin(); } catch {
    return NextResponse.json(
      { error: { code: 'UNAUTHORIZED', message: 'Admin access required.' } },
      { status: 401 }
    );
  }

  let airtableClient;
  try {
    airtableClient = getAirtableClient();
  } catch {
    return NextResponse.json(
      { error: { code: 'AIRTABLE_NOT_CONFIGURED', message: 'Airtable is not configured for this instance.' } },
      { status: 503 }
    );
  }

  // TODO(W6): replace adminClient with db once syncEntityTable is migrated to Drizzle.
  const adminClient = createAdminClient();
  const orgId = ctx.orgId;

  const idMaps: Partial<Record<EntityName, IdMap>> = {};
  const results: Array<{
    entity: EntityName;
    count: number;
    skippedLinks: number;
    status: string;
    errorMessage?: string;
  }> = [];

  for (const { tableEnvKey, entity } of ENTITY_SYNC_TARGETS) {
    const tableId = resolveEntityTableEnvKey(tableEnvKey);
    if (!tableId) {
      idMaps[entity] = new Map();
      continue;
    }

    const result = await syncEntityTable(
      orgId,
      entity,
      tableEnvKey,
      adminClient,
      airtableClient,
      idMaps
    );

    results.push({
      entity: result.entity,
      count:  result.count,
      skippedLinks: result.skippedLinks,
      status: result.status,
      errorMessage: result.errorMessage,
    });
  }

  return NextResponse.json({
    triggered: true,
    orgId,
    ran_at: new Date().toISOString(),
    results,
  });
}
