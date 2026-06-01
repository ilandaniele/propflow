/**
 * WhatsApp message template builder.
 * Returns locale-appropriate message strings for outbound notifications.
 * Locale is driven by tenant.preferred_language — independent of admin UI language.
 *
 * LLM06: No PII echoed back via templates (phone numbers, raw user input never included).
 */

import type { Locale } from '@/i18n/config';

// ─── Template definitions ─────────────────────────────────────────────────────

type TemplateKey =
  | 'paymentDue'
  | 'paymentConfirmed'
  | 'paymentPending'
  | 'receiptDuplicate'
  | 'taskReminder'
  | 'taskCompleted'
  | 'taskProofPending'
  | 'sanctionProposed'
  | 'sanctionApproved'
  | 'sanctionWarning'
  | 'leaseRenewal';

type Templates = Record<TemplateKey, (params: Record<string, string>) => string>;

const templates: Record<Locale, Templates> = {
  es: {
    paymentDue:       (p) => `Tu pago de $${p.amount} vence el ${p.date}. Accede al portal para pagar.`,
    paymentConfirmed: (p) => `Tu comprobante de $${p.amount} fue recibido y aprobado. ¡Gracias!`,
    paymentPending:   ()  => `Tu comprobante fue recibido y está en revisión. Te avisaremos pronto.`,
    receiptDuplicate: ()  => `Este comprobante ya fue procesado anteriormente.`,
    taskReminder:     (p) => `Recordatorio: tienes la tarea "${p.title}" con vencimiento el ${p.date}.`,
    taskCompleted:    (p) => `¡Tu tarea "${p.title}" fue completada exitosamente!`,
    taskProofPending: (p) => `Tu comprobante para la tarea "${p.title}" está en revisión.`,
    sanctionProposed: (p) => `Se propuso una sanción de $${p.amount} por: ${p.reason}. Pendiente de aprobación.`,
    sanctionApproved: (p) => `Se aplicó una sanción de $${p.amount} por: ${p.reason}.`,
    sanctionWarning:  (p) => `Advertencia formal: ${p.reason}.`,
    leaseRenewal:     (p) => `Tu contrato vence en ${p.days} días (${p.date}). Por favor contacta a tu propietario para renovarlo.`,
  },
  en: {
    paymentDue:       (p) => `Your payment of $${p.amount} is due on ${p.date}. Please log in to your portal.`,
    paymentConfirmed: (p) => `Your payment receipt of $${p.amount} was received and approved. Thank you!`,
    paymentPending:   ()  => `Your payment receipt was received and is under review. We will notify you soon.`,
    receiptDuplicate: ()  => `This receipt has already been processed.`,
    taskReminder:     (p) => `Reminder: you have a pending task "${p.title}" due on ${p.date}.`,
    taskCompleted:    (p) => `Your task "${p.title}" was successfully completed!`,
    taskProofPending: (p) => `Your proof for task "${p.title}" is under review.`,
    sanctionProposed: (p) => `A sanction of $${p.amount} has been proposed for: ${p.reason}. Pending approval.`,
    sanctionApproved: (p) => `A sanction of $${p.amount} has been applied for: ${p.reason}.`,
    sanctionWarning:  (p) => `Formal warning: ${p.reason}.`,
    leaseRenewal:     (p) => `Your lease expires in ${p.days} days (${p.date}). Please contact your landlord.`,
  },
  pt: {
    paymentDue:       (p) => `Seu pagamento de $${p.amount} vence em ${p.date}. Acesse o portal para pagar.`,
    paymentConfirmed: (p) => `Seu comprovante de $${p.amount} foi recebido e aprovado. Obrigado!`,
    paymentPending:   ()  => `Seu comprovante foi recebido e está em análise. Notificaremos em breve.`,
    receiptDuplicate: ()  => `Este comprovante já foi processado anteriormente.`,
    taskReminder:     (p) => `Lembrete: você tem uma tarefa "${p.title}" com vencimento em ${p.date}.`,
    taskCompleted:    (p) => `Sua tarefa "${p.title}" foi concluída com sucesso!`,
    taskProofPending: (p) => `Seu comprovante para a tarefa "${p.title}" está em análise.`,
    sanctionProposed: (p) => `Uma sanção de $${p.amount} foi proposta por: ${p.reason}. Aguardando aprovação.`,
    sanctionApproved: (p) => `Uma sanção de $${p.amount} foi aplicada por: ${p.reason}.`,
    sanctionWarning:  (p) => `Advertência formal: ${p.reason}.`,
    leaseRenewal:     (p) => `Seu contrato vence em ${p.days} dias (${p.date}). Entre em contato com seu proprietário.`,
  },
};

/**
 * Build a WhatsApp message body for the given template key and locale.
 * Falls back to 'es' if locale is unknown.
 */
export function buildWhatsAppTemplate(
  key: TemplateKey,
  locale: string,
  params: Record<string, string> = {}
): string {
  const safeLocale: Locale = (['es', 'en', 'pt'] as const).includes(locale as Locale)
    ? (locale as Locale)
    : 'es';
  return templates[safeLocale][key](params);
}
