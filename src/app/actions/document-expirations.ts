'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/auth/guards';
import { Errors, ok } from '@/lib/errors';
import type { ActionResult } from '@/lib/errors';
import { mutationRateLimit } from '@/lib/ratelimit';
import { log } from '@/lib/log';
import {
  deleteExpiringDocument,
  insertExpiringDocument,
  subjectsBelongToOrg,
} from '@/lib/document-expirations/queries';
import { CreateExpiringDocumentSchema, DeleteExpiringDocumentSchema } from '@/lib/document-expirations/schemas';

const EXPIRATIONS_PATH = '/dashboard/expirations';

function revalidateExpirations() {
  revalidatePath(EXPIRATIONS_PATH);
  revalidatePath('/dashboard');
}

export async function createExpiringDocument(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }
  if (!mutationRateLimit(ctx.userId, 'create-expiring-document').success) return Errors.RATE_LIMITED();

  const parsed = CreateExpiringDocumentSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());
  const { tenant_id: tenantId, property_id: propertyId } = parsed.data;

  if (!(await subjectsBelongToOrg(ctx.orgId, { tenantId, propertyId }))) return Errors.NOT_FOUND();

  await insertExpiringDocument({
    orgId: ctx.orgId,
    kind: parsed.data.kind,
    label: parsed.data.label,
    expiresOn: parsed.data.expires_on,
    tenantId: tenantId ?? null,
    propertyId: propertyId ?? null,
  });

  log.adminAction(ctx.userId, 'create_expiring_document', 'expiring_document');
  revalidateExpirations();
  return ok(undefined);
}

export async function removeExpiringDocument(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }
  if (!mutationRateLimit(ctx.userId, 'remove-expiring-document').success) return Errors.RATE_LIMITED();

  const parsed = DeleteExpiringDocumentSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  if (!(await deleteExpiringDocument(ctx.orgId, parsed.data.id))) return Errors.NOT_FOUND();

  log.adminAction(ctx.userId, 'remove_expiring_document', 'expiring_document', parsed.data.id);
  revalidateExpirations();
  return ok(undefined);
}
