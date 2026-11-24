import { z } from 'zod';
import { HANDOVER_KINDS, INVENTORY_CONDITIONS } from '@/lib/contracts/handover-types';
import { PdfFileSchema } from './contractDoc';

const MAX_ITEMS = 200;

const name = z.string().trim().min(1).max(120);
const quantity = z.coerce.number().int().min(1).max(999);
const condition = z.enum(INVENTORY_CONDITIONS);
const notes = z.string().trim().max(500);

export const InventoryItemSchema = z.object({
  id:        z.string().guid().optional(),
  unit_id:   z.string().guid(),
  name,
  quantity,
  condition,
  notes:     notes.optional(),
});

export const DeleteInventoryItemSchema = z.object({ id: z.string().guid() });

export const HandoverItemSchema = z.object({
  name,
  quantity,
  condition,
  notes: notes.nullable(),
});

export const CreateHandoverActSchema = z.object({
  contract_id: z.string().guid(),
  kind:        z.enum(HANDOVER_KINDS),
  notes:       z.string().trim().max(2000).optional(),
  items:       z
    .string()
    .max(200_000)
    .transform((raw, ctx) => {
      try { return JSON.parse(raw) as unknown; } catch {
        ctx.addIssue({ code: 'custom', message: 'Invalid JSON' });
        return z.NEVER;
      }
    })
    .pipe(z.array(HandoverItemSchema).min(1).max(MAX_ITEMS)),
});

export const HandoverActIdSchema = z.object({ handover_act_id: z.string().guid() });

export const SaveHandoverPdfSchema = HandoverActIdSchema.extend({ file: PdfFileSchema });
