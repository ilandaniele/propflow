import { z } from 'zod';

// Inbound webhook payload schema (mock provider contract)
export const InboundWebhookSchema = z.object({
  provider_message_id: z.string().min(1).max(255),
  from: z.string().regex(/^\+\d{7,15}$/, 'E.164 format required'),
  to: z.string().regex(/^\+\d{7,15}$/, 'E.164 format required'),
  type: z.enum(['text', 'image', 'document', 'audio', 'video']),
  text: z.string().max(4096).optional().nullable(),
  attachment_url: z.string().url().optional().nullable(),
  timestamp: z.string().datetime({ message: 'ISO8601 timestamp required' }),
});
export type InboundWebhookPayload = z.infer<typeof InboundWebhookSchema>;

// Classify result schema (LLM02: strict enum)
export const ClassifyResultSchema = z.object({
  classification: z.enum(['receipt', 'task-proof', 'incident-evidence', 'other']),
  confidence: z.number().min(0).max(1),
});
export type ClassifyResult = z.infer<typeof ClassifyResultSchema>;

// Task proof verification schema (LLM02: strict)
export const TaskProofVerifySchema = z.object({
  valid: z.boolean(),
  confidence: z.number().min(0).max(1),
  reasoning: z.string().max(500),
});
export type TaskProofVerifyResult = z.infer<typeof TaskProofVerifySchema>;

// Send message schema
export const SendWhatsAppMessageSchema = z.object({
  conversation_id: z.string().uuid(),
  body: z.string().min(1).max(4096),
});
export type SendWhatsAppMessageInput = z.infer<typeof SendWhatsAppMessageSchema>;
