/**
 * Event type definitions for the in-process automation engine.
 * IC7: fire-and-forget pub/sub — no external queue.
 */

export type EventName =
  | 'whatsapp.message.received'
  | 'whatsapp.attachment.received'
  | 'payment.receipt.detected'
  | 'payment.receipt.approved'
  | 'task.reminder_due'
  | 'task.proof_received'
  | 'task.expired'
  | 'sanction.proposed'
  | 'sanction.approved'
  | 'sanction.disputed';

export interface EventPayload {
  orgId: string;
  [key: string]: unknown;
}

// Per-event payload shapes
export interface WhatsAppMessageReceivedPayload extends EventPayload {
  conversationId: string;
  messageId: string;
  tenantId?: string | null;
  body?: string | null;
}

export interface WhatsAppAttachmentReceivedPayload extends EventPayload {
  conversationId: string;
  messageId: string;
  tenantId?: string | null;
  attachmentKind: string;
  attachmentPath: string;
  classification: string;
}

export interface PaymentReceiptDetectedPayload extends EventPayload {
  receiptId: string;
  tenantId: string;
  messageId?: string | null;
}

export interface PaymentReceiptApprovedPayload extends EventPayload {
  receiptId: string;
  tenantId: string;
  paymentId: string;
  amount: number;
}

export interface TaskReminderDuePayload extends EventPayload {
  taskId: string;
  tenantId: string;
}

export interface TaskProofReceivedPayload extends EventPayload {
  taskId: string;
  proofId: string;
  tenantId: string;
  messageId?: string | null;
}

export interface TaskExpiredPayload extends EventPayload {
  taskId: string;
  tenantId: string;
}

export interface SanctionProposedPayload extends EventPayload {
  sanctionId: string;
  tenantId: string;
  kind: 'monetary' | 'warning';
  amount?: number | null;
}

export interface SanctionApprovedPayload extends EventPayload {
  sanctionId: string;
  tenantId: string;
  chargeId?: string | null;
}

export interface SanctionDisputedPayload extends EventPayload {
  sanctionId: string;
  tenantId: string;
}

export interface TaskButtonPressedPayload extends EventPayload {
  taskId:    string;
  tenantId:  string;
  fromPhone: string;  // PII — never log
  action:    'listo' | 'no_puedo';
}

export type EventHandler<T extends EventPayload = EventPayload> = (
  payload: T,
  idempotencyKey?: string
) => Promise<void>;
