/**
 * Handler: whatsapp.attachment.received → receipt OCR auto-approve flow.
 * IC4: classify → OCR → match charge → gate (conf ≥ 0.92, ≤1% delta, no dup) → insert.
 * LLM08: auto-approval requires hard threshold — LLM cannot trigger directly.
 *
 * Migrated from Supabase admin client + storage to Drizzle ORM + Tigris (W6).
 */

import { db } from '@/lib/db';
import {
  tenants,
  profiles,
  charges,
  contracts,
  payments,
  paymentReceipts,
  notificationInbox,
} from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { getSignedUrl } from '@/lib/storage';
import { runOcr } from '@/lib/ocr/run-ocr';
import { sha256Hex } from '@/lib/whatsapp/dedupe';
import { log } from '@/lib/log';
import type { WhatsAppAttachmentReceivedPayload } from '../types';

const AUTO_APPROVE_CONFIDENCE  = 0.92;
const AUTO_APPROVE_AMOUNT_DELTA = 0.01; // 1%

export async function handleWhatsAppReceipt(
  payload: WhatsAppAttachmentReceivedPayload
): Promise<void> {
  if (payload.classification !== 'receipt') return;
  if (!payload.tenantId) return;

  const { orgId, tenantId, messageId, attachmentPath } = payload;

  // Fetch presigned URL from Tigris storage
  let signedUrl: string;
  try {
    signedUrl = await getSignedUrl('receipts', attachmentPath, 60);
  } catch (e) {
    log.error('[receipt-handler] cannot get signed URL', { orgId, attachmentPath, error: (e as Error).message });
    return;
  }

  // Fetch image bytes for OCR
  let imageBuffer: Buffer;
  let mimeType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif' = 'image/jpeg';
  try {
    const res = await fetch(signedUrl, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    imageBuffer = Buffer.from(await res.arrayBuffer());
    const ct = res.headers.get('content-type') ?? 'image/jpeg';
    if (['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(ct)) {
      mimeType = ct as typeof mimeType;
    }
  } catch (e) {
    log.error('[receipt-handler] fetch failed', { orgId, error: (e as Error).message });
    return;
  }

  const sha256      = sha256Hex(imageBuffer);
  const imageBase64 = imageBuffer.toString('base64');

  // Run OCR
  const ocrResult = await runOcr({ imageBase64, mimeType, contextTag: 'wa-receipt' });

  if (!ocrResult.success) {
    try {
      await db.insert(paymentReceipts).values({
        orgId,
        tenantId,
        source:             'whatsapp',
        whatsappMessageId:  messageId ?? null,
        imagePath:          attachmentPath,
        imageSha256:        sha256,
        status:             'pending_review',
      });
    } catch (err) {
      const code = (err as { code?: string })?.code;
      if (code === '23505') {
        log.info('[receipt-handler] duplicate detected (OCR-fail path) — skipping', { orgId });
        return;
      }
      throw err;
    }
    log.info('[receipt-handler] OCR failed → pending_review', { orgId });
    return;
  }

  const { amount, confidence } = ocrResult.data;

  // Find matching open charges for tenant
  const chargeRows = await db
    .select({ id: charges.id, amount: charges.amount, contractId: charges.contractId })
    .from(charges)
    .where(and(eq(charges.orgId, orgId), eq(charges.tenantId, tenantId)))
    .orderBy(charges.dueDate)
    .limit(10);

  let matchedChargeId: string | null   = null;
  let matchedContractId: string | null = null;
  let expectedAmount = 0;

  if (amount) {
    for (const c of chargeRows) {
      const delta = Math.abs(Number(c.amount) - amount) / Number(c.amount);
      if (delta <= AUTO_APPROVE_AMOUNT_DELTA) {
        matchedChargeId   = c.id;
        matchedContractId = c.contractId;
        expectedAmount    = Number(c.amount);
        break;
      }
    }
  }

  const safeAmount = amount ?? null;
  const isAutoApprove =
    (confidence ?? 0) >= AUTO_APPROVE_CONFIDENCE &&
    matchedChargeId !== null &&
    safeAmount !== null &&
    expectedAmount > 0 &&
    Math.abs(expectedAmount - safeAmount) / expectedAmount <= AUTO_APPROVE_AMOUNT_DELTA;

  if (isAutoApprove && safeAmount != null && matchedChargeId) {
    // B4: Before auto-approve, ensure active contract exists for the tenant.
    let contractId: string | null = matchedContractId;

    if (!contractId) {
      const chargeDetail = await db
        .select({ contractId: charges.contractId })
        .from(charges)
        .where(and(eq(charges.id, matchedChargeId), eq(charges.orgId, orgId)))
        .limit(1);
      contractId = chargeDetail[0]?.contractId ?? null;
    }

    if (!contractId) {
      const activeContracts = await db
        .select({ id: contracts.id })
        .from(contracts)
        .where(and(
          eq(contracts.orgId, orgId),
          eq(contracts.tenantId, tenantId),
          eq(contracts.status, 'active'),
        ))
        .limit(1);
      contractId = activeContracts[0]?.id ?? null;
    }

    if (!contractId) {
      log.warn('[receipt-handler] no active contract for tenant — routing to pending_review', { orgId, tenantId });

      try {
        await db.insert(paymentReceipts).values({
          orgId,
          tenantId,
          source:            'whatsapp',
          whatsappMessageId: messageId ?? null,
          imagePath:         attachmentPath,
          imageSha256:       sha256,
          extractedAmount:   String(safeAmount),
          extractedDate:     ocrResult.data.date ?? null,
          extractedVendor:   ocrResult.data.vendor ?? null,
          confidence:        String(confidence),
          matchedChargeId,
          status:            'pending_review',
        });
      } catch (err) {
        const code = (err as { code?: string })?.code;
        if (code === '23505') {
          log.info('[receipt-handler] duplicate detected (no-contract path) — skipping', { orgId });
          return;
        }
        throw err;
      }

      await notifyAdmin(orgId, tenantId, confidence, 'no_active_contract');
      log.info('[receipt-handler] pending_review (no active contract)', { orgId });
      return;
    }

    // Insert payment_receipts as auto_approved
    let receiptId: string;
    try {
      const inserted = await db.insert(paymentReceipts).values({
        orgId,
        tenantId,
        source:            'whatsapp',
        whatsappMessageId: messageId ?? null,
        imagePath:         attachmentPath,
        imageSha256:       sha256,
        extractedAmount:   String(safeAmount),
        extractedDate:     ocrResult.data.date ?? null,
        extractedVendor:   ocrResult.data.vendor ?? null,
        confidence:        String(confidence),
        matchedChargeId,
        status:            'auto_approved',
      }).returning({ id: paymentReceipts.id });

      receiptId = inserted[0]?.id ?? '';
    } catch (err) {
      const code = (err as { code?: string })?.code;
      if (code === '23505') {
        log.info('[receipt-handler] duplicate detected (auto-approve path) — skipping', { orgId });
        return;
      }
      log.error('[receipt-handler] insert receipt failed', { orgId, error: (err as Error).message });
      return;
    }

    // Create payment row
    let paymentId: string;
    try {
      const paymentInserted = await db.insert(payments).values({
        orgId,
        contractId,
        tenantId,
        amount:     String(safeAmount),
        status:     'approved',
        method:     'transfer',
        paidAt:     ocrResult.data.date ?? new Date().toISOString().slice(0, 10),
        reference:  `WA-OCR-${receiptId.slice(0, 8)}`,
        approvedAt: new Date(),
      }).returning({ id: payments.id });

      paymentId = paymentInserted[0]?.id ?? '';
    } catch (err) {
      log.error('[receipt-handler] insert payment failed', { orgId, error: (err as Error).message });
      // Receipt already inserted as auto_approved — revert to pending_review
      await db
        .update(paymentReceipts)
        .set({ status: 'pending_review' })
        .where(eq(paymentReceipts.id, receiptId));
      return;
    }

    // Link receipt to payment
    await db
      .update(paymentReceipts)
      .set({ matchedPaymentId: paymentId })
      .where(eq(paymentReceipts.id, receiptId));

    log.info('[receipt-handler] auto_approved', { orgId, receiptId });

  } else {
    // Insert as pending_review
    try {
      await db.insert(paymentReceipts).values({
        orgId,
        tenantId,
        source:            'whatsapp',
        whatsappMessageId: messageId ?? null,
        imagePath:         attachmentPath,
        imageSha256:       sha256,
        extractedAmount:   amount != null ? String(amount) : null,
        extractedDate:     ocrResult.data.date ?? null,
        extractedVendor:   ocrResult.data.vendor ?? null,
        confidence:        confidence != null ? String(confidence) : null,
        matchedChargeId,
        status:            'pending_review',
      });
    } catch (err) {
      const code = (err as { code?: string })?.code;
      if (code === '23505') {
        log.info('[receipt-handler] duplicate detected (pending_review path) — skipping', { orgId });
        return;
      }
      throw err;
    }

    await notifyAdmin(orgId, tenantId, confidence, 'below_threshold');
    log.info('[receipt-handler] pending_review', { orgId });
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function notifyAdmin(
  orgId: string,
  tenantId: string,
  confidence: number | null | undefined,
  reason: 'below_threshold' | 'no_active_contract'
): Promise<void> {
  const tenantRows = await db
    .select({ fullName: tenants.fullName })
    .from(tenants)
    .where(and(eq(tenants.id, tenantId), eq(tenants.orgId, orgId)))
    .limit(1);

  const tenant = tenantRows[0];
  if (!tenant) return;

  const adminRows = await db
    .select({ id: profiles.id })
    .from(profiles)
    .where(and(eq(profiles.orgId, orgId), eq(profiles.role, 'admin')))
    .limit(1);

  const adminProfile = adminRows[0];
  if (!adminProfile) return;

  const reasonLabel =
    reason === 'no_active_contract'
      ? 'No active contract found'
      : `Low confidence: ${((confidence ?? 0) * 100).toFixed(0)}%`;

  await db.insert(notificationInbox).values({
    orgId,
    profileId:   adminProfile.id,
    type:        'receipt_pending',
    title:       'Receipt Pending Review',
    body:        `WhatsApp receipt from ${tenant.fullName ?? 'tenant'} requires review (${reasonLabel})`,
    relatedType: 'payment_receipt',
    relatedId:   null,
  });
}
