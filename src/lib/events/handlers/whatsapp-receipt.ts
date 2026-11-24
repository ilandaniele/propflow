/**
 * Handler: whatsapp.attachment.received → receipt OCR auto-approve flow.
 * IC4: classify → OCR → match charge → gate (conf ≥ 0.92, ≤1% delta, no dup) → insert.
 * LLM08: auto-approval requires hard threshold — LLM cannot trigger directly.
 *
 * Migrated from Supabase admin client + storage to Drizzle ORM + object storage (W6; now Cloudflare R2).
 */

import { db } from '@/lib/db';
import {
  tenants,
  charges,
  contracts,
  payments,
  paymentReceipts,
} from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { getSignedUrl } from '@/lib/storage';
import { runOcr } from '@/lib/ocr/run-ocr';
import { sha256Hex } from '@/lib/whatsapp/dedupe';
import { log } from '@/lib/log';
import type { WhatsAppAttachmentReceivedPayload } from '../types';
import { isUniqueViolation } from '@/lib/db/errors';
import { notifyOrgAdmins } from '@/lib/notifications/admin-inbox';

const AUTO_APPROVE_CONFIDENCE  = 0.92;
const AUTO_APPROVE_AMOUNT_DELTA = 0.01; // 1%

export async function handleWhatsAppReceipt(
  payload: WhatsAppAttachmentReceivedPayload
): Promise<void> {
  if (payload.classification !== 'receipt') return;
  if (!payload.tenantId) return;

  const { orgId, tenantId, messageId, attachmentPath } = payload;

  // Fetch presigned URL from R2 storage
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
      if (isUniqueViolation(err)) {
        log.info('[receipt-handler] duplicate detected (OCR-fail path) — skipping', { orgId });
        return;
      }
      throw err;
    }
    await notifyAdmin(orgId, tenantId, null, 'ocr_failed');
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
        if (isUniqueViolation(err)) {
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
      if (isUniqueViolation(err)) {
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

    await notifyOrgAdmins(orgId, {
      type:        'receipt_auto_approved',
      title:       'Payment Registered From Receipt',
      body:        `WhatsApp receipt for ${safeAmount} was matched to a charge and registered automatically`,
      relatedType: 'payment',
      relatedId:   paymentId,
    }).catch((e: Error) => log.warn('[receipt-handler] admin notification failed', { orgId, error: e.message }));

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
      if (isUniqueViolation(err)) {
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
  reason: 'below_threshold' | 'no_active_contract' | 'ocr_failed'
): Promise<void> {
  const tenantRows = await db
    .select({ fullName: tenants.fullName })
    .from(tenants)
    .where(and(eq(tenants.id, tenantId), eq(tenants.orgId, orgId)))
    .limit(1);

  const tenant = tenantRows[0];
  if (!tenant) return;

  const reasonLabel = {
    no_active_contract: 'No active contract found',
    ocr_failed: 'Could not read the receipt',
    below_threshold: `Low confidence: ${((confidence ?? 0) * 100).toFixed(0)}%`,
  }[reason];

  await notifyOrgAdmins(orgId, {
    type:        'receipt_pending',
    title:       'Receipt Pending Review',
    body:        `WhatsApp receipt from ${tenant.fullName ?? 'tenant'} requires review (${reasonLabel})`,
    relatedType: 'payment_receipt',
  });
}
