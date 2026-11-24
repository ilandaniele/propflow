'use server';

import { revalidatePath } from 'next/cache';
import { and, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { documents } from '@/lib/db/schema';
import { requireAdmin, requireTenant } from '@/lib/auth/guards';
import { Errors, ok, type ActionResult } from '@/lib/errors';
import { mutationRateLimit } from '@/lib/ratelimit';
import { log } from '@/lib/log';
import { deleteImage, getSignedUrl } from '@/lib/storage';
import { asBatch, chunk, rowsPerInsert } from '@/lib/db/batch';
import { DocumentIdSchema, UploadDocumentsSchema } from '@/lib/schemas/documents';
import {
  DOCUMENTS_BUCKET as BUCKET,
  documentNameFor,
  storeDocumentFile,
  uploadResults,
  type DocumentUploadResult,
} from '@/lib/documents/upload';
import {
  findDocument,
  findOwnedEntity,
  findPortalDocument,
  findTenantIdForUser,
} from '@/lib/documents/queries';

const URL_TTL_S = 300;
const DOCUMENT_ROWS_PER_INSERT = rowsPerInsert(documents);

function revalidateDocuments() {
  revalidatePath('/dashboard/documents');
  revalidatePath('/portal/documents');
}

export async function uploadDocuments(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult<{ results: DocumentUploadResult[] }>> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }
  if (!mutationRateLimit(ctx.userId, 'documents').success) return Errors.RATE_LIMITED();

  const parsed = UploadDocumentsSchema.safeParse({ ...Object.fromEntries(formData), files: formData.getAll('files') });
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());
  const { entity_type: entity, entity_id: entityId, files, name, ...fields } = parsed.data;

  if (!(await findOwnedEntity(ctx.orgId, entity, entityId))) return Errors.NOT_FOUND();

  const target = {
    orgId:           ctx.orgId,
    userId:          ctx.userId,
    entity,
    entityId,
    category:        fields.category,
    expiresOn:       fields.expires_on || null,
    visibleToTenant: fields.visible_to_tenant === 'on',
  };
  const stored = await Promise.all(
    files.map((file) => storeDocumentFile(target, file, documentNameFor(file.name, name, files.length))),
  );

  const rows = stored.flatMap((outcome) => ('row' in outcome ? [outcome.row] : []));
  const batch = asBatch(chunk(rows, DOCUMENT_ROWS_PER_INSERT).map((part) => db.insert(documents).values(part)));
  if (batch) {
    await db.batch(batch);
    log.adminAction(ctx.userId, 'upload_document', entity, entityId);
    revalidateDocuments();
  }
  return ok({ results: uploadResults(files, stored) });
}

export async function deleteDocument(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }
  if (!mutationRateLimit(ctx.userId, 'documents').success) return Errors.RATE_LIMITED();

  const parsed = DocumentIdSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  const [deleted] = await db
    .delete(documents)
    .where(and(eq(documents.id, parsed.data.id), eq(documents.orgId, ctx.orgId)))
    .returning({ storagePath: documents.storagePath });
  if (!deleted) return Errors.NOT_FOUND();

  try {
    await deleteImage(BUCKET, deleted.storagePath);
  } catch (error) {
    log.warn('document object delete failed', { error: String(error) });
  }

  log.adminAction(ctx.userId, 'delete_document', 'document', parsed.data.id);
  revalidateDocuments();
  return ok(undefined);
}

export async function getDocumentUrl(_prev: ActionResult, formData: FormData): Promise<ActionResult<{ url: string }>> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }
  if (!mutationRateLimit(ctx.userId, 'document_url').success) return Errors.RATE_LIMITED();

  const parsed = DocumentIdSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  const document = await findDocument(ctx.orgId, parsed.data.id);
  if (!document) return Errors.NOT_FOUND();
  return ok({ url: await getSignedUrl(BUCKET, document.storagePath, URL_TTL_S) });
}

export async function getPortalDocumentUrl(_prev: ActionResult, formData: FormData): Promise<ActionResult<{ url: string }>> {
  let ctx;
  try { ctx = await requireTenant(); } catch { return Errors.UNAUTHORIZED(); }
  if (!mutationRateLimit(ctx.userId, 'document_url').success) return Errors.RATE_LIMITED();

  const parsed = DocumentIdSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());

  const tenantId = await findTenantIdForUser(ctx.orgId, ctx.userId);
  const document = tenantId ? await findPortalDocument(ctx.orgId, tenantId, parsed.data.id) : null;
  if (!document) return Errors.NOT_FOUND();
  return ok({ url: await getSignedUrl(BUCKET, document.storagePath, URL_TTL_S) });
}
