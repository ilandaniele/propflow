import { z } from 'zod';
import {
  DOCUMENT_CATEGORIES,
  DOCUMENT_ENTITIES,
  MAX_DOCUMENT_BYTES,
  MAX_DOCUMENT_UPLOAD_BYTES,
  MAX_DOCUMENTS_PER_UPLOAD,
} from '@/lib/documents/types';

export const DocumentFileSchema = z
  .instanceof(File)
  .refine((f) => f.size > 0 && f.size <= MAX_DOCUMENT_BYTES, 'File must be between 1 byte and 5 MB');

export const UploadDocumentsSchema = z
  .object({
    entity_type:       z.enum(DOCUMENT_ENTITIES),
    entity_id:         z.string().guid(),
    name:              z.string().trim().max(120).optional(),
    category:          z.enum(DOCUMENT_CATEGORIES),
    expires_on:        z.union([z.literal(''), z.iso.date()]).optional(),
    visible_to_tenant: z.literal('on').optional(),
    files:             z
      .array(z.instanceof(File))
      .min(1)
      .max(MAX_DOCUMENTS_PER_UPLOAD)
      .refine((files) => files.reduce((total, f) => total + f.size, 0) <= MAX_DOCUMENT_UPLOAD_BYTES, 'Files must total 20 MB or less'),
  })
  .refine((data) => data.files.length > 1 || Boolean(data.name), { path: ['name'], message: 'Name is required for a single file' });

export const DocumentIdSchema = z.object({ id: z.string().guid() });

export const DocumentFilterSchema = z.object({
  entity:   z.enum(DOCUMENT_ENTITIES).optional().catch(undefined),
  expiring: z.literal('1').optional().catch(undefined),
});
