'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/auth/guards';
import { Errors, ok, type ActionResult } from '@/lib/errors';
import { mutationRateLimit } from '@/lib/ratelimit';
import { log } from '@/lib/log';
import { parseCsv } from '@/lib/import/csv';
import { DataImportFormSchema, type DataImportKind } from '@/lib/data-import/schemas';
import { planImport, type PlannedRow, type PlannedStatus } from '@/lib/data-import/plan';
import { insertPlannedRows, loadExistingKeys } from '@/lib/data-import/queries';

const PREVIEW_ROWS = 200;

export interface DataImportPreview {
  kind:   DataImportKind;
  counts: Record<PlannedStatus, number>;
  rows:   Omit<PlannedRow, 'values'>[];
}

export interface DataImportResult {
  inserted: number;
  skipped:  number;
}

type Planned = { kind: DataImportKind; rows: PlannedRow[] };

async function planFromForm(orgId: string, formData: FormData): Promise<ActionResult<Planned>> {
  const parsed = DataImportFormSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());
  const { kind, file } = parsed.data;

  const csv = parseCsv(Buffer.from(await file.arrayBuffer()));
  if (!csv.ok) return Errors.VALIDATION_ERROR({ formErrors: [csv.error.code], fieldErrors: {} });

  const rawRows = csv.result.rows.map((row) => row.rawData as Record<string, unknown>);
  return ok({ kind, rows: planImport(kind, rawRows, await loadExistingKeys(orgId, kind)) });
}

function countByStatus(rows: PlannedRow[]): Record<PlannedStatus, number> {
  const counts: Record<PlannedStatus, number> = { new: 0, duplicate: 0, invalid: 0, unknown_property: 0 };
  for (const row of rows) counts[row.status] += 1;
  return counts;
}

export async function previewDataImport(_prev: ActionResult<DataImportPreview>, formData: FormData): Promise<ActionResult<DataImportPreview>> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }
  if (!mutationRateLimit(ctx.userId, 'data-import').success) return Errors.RATE_LIMITED();

  const planned = await planFromForm(ctx.orgId, formData);
  if (!planned.data) return { error: planned.error };
  const { kind, rows } = planned.data;

  return ok({
    kind,
    counts: countByStatus(rows),
    rows:   rows.slice(0, PREVIEW_ROWS).map(({ values: _values, ...row }) => row),
  });
}

export async function commitDataImport(_prev: ActionResult<DataImportResult>, formData: FormData): Promise<ActionResult<DataImportResult>> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }
  if (!mutationRateLimit(ctx.userId, 'data-import').success) return Errors.RATE_LIMITED();

  const planned = await planFromForm(ctx.orgId, formData);
  if (!planned.data) return { error: planned.error };
  const { kind, rows } = planned.data;

  const inserted = await insertPlannedRows(ctx.orgId, kind, rows);
  log.adminAction(ctx.userId, 'data_import', kind, String(inserted));
  revalidatePath('/dashboard/properties');
  revalidatePath('/dashboard/units');
  return ok({ inserted, skipped: rows.length - inserted });
}
