'use server';

import { revalidatePath } from 'next/cache';
import { and, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { documents } from '@/lib/db/schema';
import { requireAdmin, requireTenant } from '@/lib/auth/guards';
import { Errors, ok, type ActionResult } from '@/lib/errors';
import { mutationRateLimit } from '@/lib/ratelimit';
import { log } from '@/lib/log';
import { deleteImage, getSignedUrl, uploadFile } from '@/lib/storage';
import { DocumentIdSchema, UploadDocumentSchema } from '@/lib/schemas/documents';
import { detectDocumentMime } from '@/lib/documents/mime';
import { DOCUMENT_MIME_EXTENSIONS } from '@/lib/documents/types';
import {
  documentStoragePath,
  findDocument,
  findOwnedEntity,
  findPortalDocument,
  findTenantIdForUser,
} from '@/lib/documents/queries';

const BUCKET = 'documents';
const URL_TTL_S = 300;

function revalidateDocuments() {
  revalidatePath('/dashboard/documents');
  revalidatePath('/portal/documents');
}

export async function uploadDocument(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  let ctx;
  try { ctx = await requireAdmin(); } catch { return Errors.UNAUTHORIZED(); }
  if (!mutationRateLimit(ctx.userId, 'documents').success) return Errors.RATE_LIMITED();

  const parsed = UploadDocumentSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return Errors.VALIDATION_ERROR(parsed.error.flatten());
  const { entity_type: entity, entity_id: entityId, file, ...fields } = parsed.data;

  if (!(await findOwnedEntity(ctx.orgId, entity, entityId))) return Errors.NOT_FOUND();

  const bytes = Buffer.from(await file.arrayBuffer());
  const mimeType = detectDocumentMime(bytes);
  if (!mimeType) return Errors.VALIDATION_ERROR({ formErrors: ['Unsupported file type'], fieldErrors: {} });

  const id = crypto.randomUUID();
  const storagePath = documentStoragePath(ctx.orgId, id, DOCUMENT_MIME_EXTENSIONS[mimeType]);
  try {
    await uploadFile(BUCKET, storagePath, bytes, mimeType);
  } catch (error) {
    log.error('document upload failed', { error: String(error) });
    return Errors.INTERNAL();
  }

  await db.insert(documents).values({
    id,
    orgId:           ctx.orgId,
    tenantId:        entity === 'tenant' ? entityId : null,
    contractId:      entity === 'contract' ? entityId : null,
    propertyId:      entity === 'property' ? entityId : null,
    name:            fields.name,
    category:        fields.category,
    storagePath,
    mimeType,
    sizeBytes:       bytes.length,
    expiresOn:       fields.expires_on || null,
    visibleToTenant: fields.visible_to_tenant === 'on' && entity !== 'property',
    uploadedBy:      ctx.userId,
  });

  log.adminAction(ctx.userId, 'upload_document', entity, entityId);
  revalidateDocuments();
  return ok(undefined);
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
