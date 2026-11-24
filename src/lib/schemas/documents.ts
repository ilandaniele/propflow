import { z } from 'zod';
import { DOCUMENT_CATEGORIES, DOCUMENT_ENTITIES, MAX_DOCUMENT_BYTES } from '@/lib/documents/types';

export const UploadDocumentSchema = z.object({
  entity_type:       z.enum(DOCUMENT_ENTITIES),
  entity_id:         z.string().guid(),
  name:              z.string().trim().min(1).max(120),
  category:          z.enum(DOCUMENT_CATEGORIES),
  expires_on:        z.union([z.literal(''), z.iso.date()]).optional(),
  visible_to_tenant: z.literal('on').optional(),
  file:              z.instanceof(File).refine((f) => f.size > 0 && f.size <= MAX_DOCUMENT_BYTES, 'File must be between 1 byte and 5 MB'),
});

export const DocumentIdSchema = z.object({ id: z.string().guid() });

export const DocumentFilterSchema = z.object({
  entity:   z.enum(DOCUMENT_ENTITIES).optional().catch(undefined),
  expiring: z.literal('1').optional().catch(undefined),
});
