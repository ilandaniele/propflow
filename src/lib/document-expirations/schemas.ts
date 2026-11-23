import { z } from 'zod';
import { EXPIRING_DOCUMENT_KINDS } from '@/lib/db/schema';

const optionalGuid = z.preprocess((v) => (v === '' ? undefined : v), z.string().guid().optional());

export const CreateExpiringDocumentSchema = z.object({
  kind: z.enum(EXPIRING_DOCUMENT_KINDS),
  label: z.string().trim().min(1).max(200),
  expires_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  tenant_id: optionalGuid,
  property_id: optionalGuid,
});

export const DeleteExpiringDocumentSchema = z.object({ id: z.string().guid() });
