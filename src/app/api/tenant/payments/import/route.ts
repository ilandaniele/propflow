/**
 * POST /api/tenant/payments/import
 * Upserts validated payment rows for the authenticated tenant.
 * Tenant-imported payments are set to status='under_review'.
 */

export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireTenant } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { profiles, tenants, importLogs, payments } from '@/lib/db/schema';
import { eq, and, inArray } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { parsePaymentsCsv } from '@/lib/csv/parsePaymentsCsv';

const MAX_CSV_BYTES = 5 * 1024 * 1024;

export async function POST(request: NextRequest): Promise<NextResponse> {
  let ctx;
  try { ctx = await requireTenant(); } catch {
    return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: 'Tenant access required.' } }, { status: 401 });
  }

  let formData: FormData;
  try { formData = await request.formData(); } catch {
    return NextResponse.json({ error: { code: 'INVALID_REQUEST', message: 'Expected multipart/form-data.' } }, { status: 400 });
  }

  const file = formData.get('file') as File | null;
  if (!file) {
    return NextResponse.json({ error: { code: 'MISSING_FILE', message: 'No se recibió archivo CSV.' } }, { status: 400 });
  }
  if (file.size > MAX_CSV_BYTES) {
    return NextResponse.json({ error: { code: 'FILE_TOO_LARGE', message: 'El archivo excede 5 MB.' } }, { status: 400 });
  }

  const csvText = await file.text();
  const { rows, errors } = parsePaymentsCsv(csvText);

  // Get profile for email security check — Drizzle (AC1, AC8: orgId scoped)
  const profileRows = await db
    .select({ email: profiles.email })
    .from(profiles)
    .where(and(eq(profiles.userId, ctx.userId), eq(profiles.orgId, ctx.orgId)))
    .limit(1);

  const tenantEmail = (profileRows[0]?.email ?? '').trim().toLowerCase();

  // Get tenant record — Drizzle (AC1, AC8: profileId + orgId scoped)
  const tenantRows = await db
    .select({ id: tenants.id })
    .from(tenants)
    .where(and(eq(tenants.profileId, ctx.userId), eq(tenants.orgId, ctx.orgId)))
    .limit(1);

  const tenantRecord = tenantRows[0];
  if (!tenantRecord) {
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Tenant record not found.' } }, { status: 404 });
  }

  // Create import log — Drizzle (AC1)
  const importLogRows = await db
    .insert(importLogs)
    .values({
      orgId: ctx.orgId,
      importType: 'payment',
      fileName: file.name,
      importedBy: ctx.userId,
      role: 'tenant',
      status: 'pending',
      rowsReceived: rows.length,
      errorDetails: errors,
    })
    .returning({ id: importLogs.id });

  const importLog = importLogRows[0];
  if (!importLog) {
    return NextResponse.json({ error: { code: 'INTERNAL_ERROR', message: 'No se pudo iniciar la importación.' } }, { status: 500 });
  }

  const import_id = importLog.id;
  let created = 0, updated = 0, skipped = 0, failed = 0;

  for (const row of rows) {
    // Security: only allow own email
    if (row.tenant_email && row.tenant_email !== tenantEmail) {
      skipped++;
      continue;
    }

    try {
      if (row.external_payment_id) {
        // Upsert by org_id + external_payment_id
        // NOTE: payments.contract_id is notNull() in schema but CSV imports do not supply it.
        // TODO(W1/schema): relax contract_id to nullable for import rows, then switch to Drizzle .insert()/.onConflictDoUpdate().
        await db.execute(sql`
          INSERT INTO payments (
            org_id, tenant_id, amount, currency,
            paid_at, due_date, status, method, reference,
            period_month, movement_type, notes,
            external_payment_id, import_source, import_id,
            contract_id
          )
          SELECT
            ${ctx.orgId}::uuid,
            ${tenantRecord.id}::uuid,
            ${row.amount},
            ${row.currency ?? 'PEN'},
            ${row.payment_date},
            ${row.due_date ?? null},
            ${'under_review'},
            ${row.payment_method ?? 'transfer'},
            ${row.reference ?? null},
            ${row.billing_period ?? null},
            ${'payment'},
            ${row.description ?? null},
            ${row.external_payment_id},
            ${'csv_import'},
            ${import_id}::uuid,
            c.id
          FROM contracts c
          WHERE c.tenant_id = ${tenantRecord.id}::uuid
            AND c.org_id = ${ctx.orgId}::uuid
            AND c.status = 'active'
          ORDER BY c.created_at DESC
          LIMIT 1
          ON CONFLICT (org_id, external_payment_id) DO UPDATE SET
            amount = EXCLUDED.amount,
            currency = EXCLUDED.currency,
            paid_at = EXCLUDED.paid_at,
            method = EXCLUDED.method,
            reference = EXCLUDED.reference,
            period_month = EXCLUDED.period_month,
            notes = EXCLUDED.notes,
            import_id = EXCLUDED.import_id,
            updated_at = NOW()
        `);
        updated++;
      } else {
        await db.execute(sql`
          INSERT INTO payments (
            org_id, tenant_id, amount, currency,
            paid_at, due_date, status, method, reference,
            period_month, movement_type, notes,
            import_source, import_id,
            contract_id
          )
          SELECT
            ${ctx.orgId}::uuid,
            ${tenantRecord.id}::uuid,
            ${row.amount},
            ${row.currency ?? 'PEN'},
            ${row.payment_date},
            ${row.due_date ?? null},
            ${'under_review'},
            ${row.payment_method ?? 'transfer'},
            ${row.reference ?? null},
            ${row.billing_period ?? null},
            ${'payment'},
            ${row.description ?? null},
            ${'csv_import'},
            ${import_id}::uuid,
            c.id
          FROM contracts c
          WHERE c.tenant_id = ${tenantRecord.id}::uuid
            AND c.org_id = ${ctx.orgId}::uuid
            AND c.status = 'active'
          ORDER BY c.created_at DESC
          LIMIT 1
        `);
        created++;
      }
    } catch {
      failed++;
    }
  }

  // Update import log — Drizzle (AC1)
  const finalStatus = failed > 0 && created + updated === 0 ? 'failed'
    : failed > 0 ? 'partial'
    : 'completed';

  await db
    .update(importLogs)
    .set({
      status: finalStatus,
      rowsCreated: created,
      rowsUpdated: updated,
      rowsSkipped: skipped,
      rowsFailed: failed,
      completedAt: new Date(),
    })
    .where(eq(importLogs.id, import_id));

  return NextResponse.json({ created, updated, skipped, failed, import_id });
}
