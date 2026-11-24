import { z } from 'zod';

export const CreatePropertyGroupSchema = z.object({
  name: z.string().trim().min(1).max(100),
  property_ids: z.array(z.string().guid()).min(1).max(200),
});

export const DeletePropertyGroupSchema = z.object({ id: z.string().guid() });
