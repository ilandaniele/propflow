/**
 * POST /api/admin/payments/import
 * Upserts validated payment rows (admin — can set any tenant/status).
 *
 * NOTE: The payments.contractId is required in the Drizzle schema but CSV imports
 * historically do not supply a contract_id. This route uses raw sql for the upsert
 * to remain compatible with the existing DB constraint behaviour (which may be nullable
 * in the actual Postgres schema even if the Drizzle type says notNull).
 * TODO(W1/schema): reconcile payments.contractId nullability with CSV import flow.
 */

export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { requireAdmin } from '@/lib/auth/guards';
import { db } from '@/lib/db';
import { importLogs, tenants, payments } from '@/lib/db/schema';
import { eq, and, inArray } from 'drizzle-orm';
import { parsePaymentsCsv } from '@/lib/csv/parsePaymentsCsv';

const MAX_CSV_BYTES = 5 * 1024 * 1024;

export async function POST(request: NextRequest): Promise<NextResponse> {
  let ctx;
  try { ctx = await requireAdmin(); } catch {
    return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: 'Admin access required.' } }, { status: 401 });
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

  // Build tenant email → id map for this org — Drizzle (AC1, AC8)
  const tenantEmails = [...new Set(rows.map(r => r.tenant_email).filter(Boolean))] as string[];
  const tenantEmailMap: Record<string, string> = {};
  if (tenantEmails.length > 0) {
    const tenantRows = await db
      .select({ id: tenants.id, email: tenants.email })
      .from(tenants)
      .where(and(eq(tenants.orgId, ctx.orgId), inArray(tenants.email!, tenantEmails)));
    tenantRows.forEach(t => { if (t.email) tenantEmailMap[t.email] = t.id; });
  }

  // Create import log — Drizzle (AC1)
  const logRows = await db
    .insert(importLogs)
    .values({
      orgId:        ctx.orgId,
      importType:   'payment',
      fileName:     file.name,
      importedBy:   ctx.userId,
      role:         'admin',
      status:       'pending',
      rowsReceived: rows.length,
      errorDetails: errors,
    })
    .returning({ id: importLogs.id });

  if (logRows.length === 0) {
    console.error('[api/admin/payments/import POST] log insert failed');
    return NextResponse.json({ error: { code: 'INTERNAL_ERROR', message: 'No se pudo iniciar la importación.' } }, { status: 500 });
  }

  const import_id = logRows[0].id;
  let created = 0, updated = 0, skipped = 0, failed = 0;

  for (const row of rows) {
    const tenant_id = row.tenant_id ?? (row.tenant_email ? tenantEmailMap[row.tenant_email] : undefined);
    if (!tenant_id) { skipped++; continue; }

    try {
      if (row.external_payment_id) {
        // Upsert by org_id + external_payment_id using raw SQL (avoids contract_id notNull type issue)
        await db.execute(sql`
          INSERT INTO payments (org_id, tenant_id, amount, currency, paid_at, due_date, status,
            method, reference, period_month, movement_type, notes, external_payment_id,
            import_source, import_id, updated_at)
          VALUES (
            ${ctx.orgId}::uuid, ${tenant_id}::uuid, ${row.amount}, ${row.currency ?? 'PEN'},
            ${row.payment_date}, ${row.due_date ?? null}, ${row.status},
            ${row.payment_method ?? 'transfer'}, ${row.reference ?? null},
            ${row.billing_period ?? null}, 'payment', ${row.description ?? null},
            ${row.external_payment_id}, 'csv_import', ${import_id}::uuid, NOW()
          )
          ON CONFLICT (org_id, external_payment_id) DO UPDATE SET
            amount        = EXCLUDED.amount,
            status        = EXCLUDED.status,
            paid_at       = EXCLUDED.paid_at,
            import_id     = EXCLUDED.import_id,
            updated_at    = NOW()
        `);
        updated++;
      } else {
        await db.execute(sql`
          INSERT INTO payments (org_id, tenant_id, amount, currency, paid_at, due_date, status,
            method, reference, period_month, movement_type, notes,
            import_source, import_id, updated_at)
          VALUES (
            ${ctx.orgId}::uuid, ${tenant_id}::uuid, ${row.amount}, ${row.currency ?? 'PEN'},
            ${row.payment_date}, ${row.due_date ?? null}, ${row.status},
            ${row.payment_method ?? 'transfer'}, ${row.reference ?? null},
            ${row.billing_period ?? null}, 'payment', ${row.description ?? null},
            'csv_import', ${import_id}::uuid, NOW()
          )
        `);
        created++;
      }
    } catch {
      failed++;
    }
  }

  const finalStatus = failed > 0 && created + updated === 0 ? 'failed'
    : failed > 0 ? 'partial'
    : 'completed';

  await db
    .update(importLogs)
    .set({
      status:      finalStatus,
      rowsCreated: created,
      rowsUpdated: updated,
      rowsSkipped: skipped,
      rowsFailed:  failed,
      completedAt: new Date(),
    })
    .where(eq(importLogs.id, import_id));

  return NextResponse.json({ created, updated, skipped, failed, import_id });
}
