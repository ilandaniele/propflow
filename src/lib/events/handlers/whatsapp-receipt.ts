/**
 * Handler: whatsapp.attachment.received → receipt OCR auto-approve flow.
 * IC4: classify → OCR → match charge → gate (conf ≥ 0.92, ≤1% delta, no dup) → insert.
 * LLM08: auto-approval requires hard threshold — LLM cannot trigger directly.
 */

import { createAdminClient } from '@/lib/supabase/admin';
import { runOcr } from '@/lib/ocr/run-ocr';
import { sha256Hex } from '@/lib/whatsapp/dedupe';
import { log } from '@/lib/log';
import type { WhatsAppAttachmentReceivedPayload } from '../types';

const AUTO_APPROVE_CONFIDENCE = 0.92;
const AUTO_APPROVE_AMOUNT_DELTA = 0.01; // 1%

export async function handleWhatsAppReceipt(
  payload: WhatsAppAttachmentReceivedPayload
): Promise<void> {
  if (payload.classification !== 'receipt') return;
  if (!payload.tenantId) return;

  const { orgId, tenantId, messageId, attachmentPath } = payload;
  const adminClient = createAdminClient();

  // Fetch the stored attachment from Supabase storage
  const { data: signedUrlData } = await adminClient.storage
    .from('receipts')
    .createSignedUrl(attachmentPath, 60);

  if (!signedUrlData?.signedUrl) {
    log.error('[receipt-handler] cannot get signed URL', { orgId, attachmentPath });
    return;
  }

  // Fetch image bytes for OCR
  let imageBuffer: Buffer;
  let mimeType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif' = 'image/jpeg';
  try {
    const res = await fetch(signedUrlData.signedUrl, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    imageBuffer = Buffer.from(await res.arrayBuffer());
    const ct = res.headers.get('content-type') ?? 'image/jpeg';
    if (['image/jpeg','image/png','image/webp','image/gif'].includes(ct)) {
      mimeType = ct as typeof mimeType;
    }
  } catch (e) {
    log.error('[receipt-handler] fetch failed', { orgId, error: (e as Error).message });
    return;
  }

  const sha256 = sha256Hex(imageBuffer);
  const imageBase64 = imageBuffer.toString('base64');

  // Duplicate check
  const { data: existing } = await adminClient
    .from('payment_receipts')
    .select('id, status')
    .eq('org_id', orgId)
    .eq('image_sha256', sha256)
    .limit(1)
    .single();

  if (existing) {
    // Duplicate — insert row with duplicate_rejected status
    await adminClient.from('payment_receipts').insert({
      org_id: orgId,
      tenant_id: tenantId,
      source: 'whatsapp',
      whatsapp_message_id: messageId ?? null,
      image_path: attachmentPath,
      image_sha256: sha256 + '_dup_' + Date.now(), // avoid unique constraint
      extracted_amount: null,
      confidence: 0,
      status: 'duplicate_rejected',
    });
    log.info('[receipt-handler] duplicate rejected', { orgId });
    return;
  }

  // Run OCR
  const ocrResult = await runOcr({ imageBase64, mimeType, contextTag: 'wa-receipt' });

  if (!ocrResult.success) {
    // Insert as pending_review
    await adminClient.from('payment_receipts').insert({
      org_id: orgId,
      tenant_id: tenantId,
      source: 'whatsapp',
      whatsapp_message_id: messageId ?? null,
      image_path: attachmentPath,
      image_sha256: sha256,
      status: 'pending_review',
    });
    log.info('[receipt-handler] OCR failed → pending_review', { orgId });
    return;
  }

  const { amount, confidence } = ocrResult.data;

  // Find matching open charge for tenant
  const { data: charges } = await adminClient
    .from('charges')
    .select('id, amount')
    .eq('org_id', orgId)
    .eq('tenant_id', tenantId)
    .order('due_date', { ascending: true })
    .limit(10);

  let matchedChargeId: string | null = null;
  let expectedAmount = 0;
  if (charges && amount) {
    for (const c of charges) {
      const delta = Math.abs(Number(c.amount) - amount) / Number(c.amount);
      if (delta <= AUTO_APPROVE_AMOUNT_DELTA) {
        matchedChargeId = c.id;
        expectedAmount = Number(c.amount);
        break;
      }
    }
  }

  // Gate: confidence ≥ 0.92 AND amount within 1% of a charge AND no duplicate
  const safeAmount = amount ?? null;
  const isAutoApprove =
    (confidence ?? 0) >= AUTO_APPROVE_CONFIDENCE &&
    matchedChargeId !== null &&
    safeAmount !== null &&
    safeAmount !== undefined &&
    expectedAmount > 0 &&
    Math.abs(expectedAmount - safeAmount) / expectedAmount <= AUTO_APPROVE_AMOUNT_DELTA;

  if (isAutoApprove && safeAmount != null && matchedChargeId) {
    // Insert payment_receipts row with auto_approved
    const { data: receipt, error: receiptErr } = await adminClient
      .from('payment_receipts')
      .insert({
        org_id: orgId,
        tenant_id: tenantId,
        source: 'whatsapp',
        whatsapp_message_id: messageId ?? null,
        image_path: attachmentPath,
        image_sha256: sha256,
        extracted_amount: safeAmount,
        extracted_date: ocrResult.data.date ?? null,
        extracted_vendor: ocrResult.data.vendor ?? null,
        confidence,
        matched_charge_id: matchedChargeId,
        status: 'auto_approved',
      })
      .select('id')
      .single();

    if (receiptErr || !receipt) {
      log.error('[receipt-handler] insert receipt failed', { code: receiptErr?.code });
      return;
    }

    // Create payment row
    await adminClient.from('payments').insert({
      org_id: orgId,
      tenant_id: tenantId,
      amount: safeAmount,
      status: 'approved',
      method: 'transfer',
      paid_at: ocrResult.data.date ?? new Date().toISOString().slice(0, 10),
      reference: `WA-OCR-${receipt.id.slice(0, 8)}`,
      approved_at: new Date().toISOString(),
    });

    // Update receipt with matched_payment_id
    const { data: payment } = await adminClient
      .from('payments')
      .select('id')
      .eq('org_id', orgId)
      .eq('tenant_id', tenantId)
      .eq('reference', `WA-OCR-${receipt.id.slice(0, 8)}`)
      .single();

    if (payment) {
      await adminClient
        .from('payment_receipts')
        .update({ matched_payment_id: payment.id })
        .eq('id', receipt.id);
    }

    log.info('[receipt-handler] auto_approved', { orgId, receiptId: receipt.id });
  } else {
    // Insert as pending_review
    await adminClient.from('payment_receipts').insert({
      org_id: orgId,
      tenant_id: tenantId,
      source: 'whatsapp',
      whatsapp_message_id: messageId ?? null,
      image_path: attachmentPath,
      image_sha256: sha256,
      extracted_amount: amount ?? null,
      extracted_date: ocrResult.data.date ?? null,
      extracted_vendor: ocrResult.data.vendor ?? null,
      confidence: confidence ?? null,
      matched_charge_id: matchedChargeId,
      status: 'pending_review',
    });

    // Notify admin
    const { data: tenantRow } = await adminClient
      .from('tenants')
      .select('org_id, full_name')
      .eq('id', tenantId)
      .single();

    if (tenantRow) {
      // Find an admin profile to notify
      const { data: adminProfile } = await adminClient
        .from('profiles')
        .select('id')
        .eq('org_id', orgId)
        .eq('role', 'admin')
        .limit(1)
        .single();

      if (adminProfile) {
        await adminClient.from('notification_inbox').insert({
          org_id: orgId,
          profile_id: adminProfile.id,
          type: 'receipt_pending',
          title: 'Receipt Pending Review',
          body: `WhatsApp receipt from ${tenantRow.full_name} requires review (confidence: ${((confidence ?? 0) * 100).toFixed(0)}%)`,
          related_type: 'payment_receipt',
        });
      }
    }

    log.info('[receipt-handler] pending_review', { orgId });
  }
}
