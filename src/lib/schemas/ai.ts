import { z } from 'zod';

export const AiChatSchema = z.object({
  session_id: z.string().uuid(),
  message: z.string().min(1).max(4000),
});
export type AiChatInput = z.infer<typeof AiChatSchema>;
