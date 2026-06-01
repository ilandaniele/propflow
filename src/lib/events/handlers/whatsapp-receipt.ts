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

  // Run OCR
  const ocrResult = await runOcr({ imageBase64, mimeType, contextTag: 'wa-receipt' });

  if (!ocrResult.success) {
    // Insert as pending_review — attempt insert and handle 23505 (duplicate) gracefully
    const { error: insertErr } = await adminClient.from('payment_receipts').insert({
      org_id: orgId,
      tenant_id: tenantId,
      source: 'whatsapp',
      whatsapp_message_id: messageId ?? null,
      image_path: attachmentPath,
      image_sha256: sha256,
      status: 'pending_review',
    });
    if (insertErr?.code === '23505') {
      log.info('[receipt-handler] duplicate detected (OCR-fail path) — skipping', { orgId });
      return;
    }
    log.info('[receipt-handler] OCR failed → pending_review', { orgId });
    return;
  }

  const { amount, confidence } = ocrResult.data;

  // Find matching open charge for tenant (include contract_id for later use)
  const { data: charges } = await adminClient
    .from('charges')
    .select('id, amount, contract_id')
    .eq('org_id', orgId)
    .eq('tenant_id', tenantId)
    .order('due_date', { ascending: true })
    .limit(10);

  let matchedChargeId: string | null = null;
  let matchedContractId: string | null = null;
  let expectedAmount = 0;
  if (charges && amount) {
    for (const c of charges) {
      const delta = Math.abs(Number(c.amount) - amount) / Number(c.amount);
      if (delta <= AUTO_APPROVE_AMOUNT_DELTA) {
        matchedChargeId = c.id;
        matchedContractId = c.contract_id as string | null;
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
    // B4: Before auto-approve, verify an active contract exists for the tenant.
    // Prefer the contract linked to the matched charge; fall back to any active contract.
    let contractId: string | null = matchedContractId;

    if (!contractId) {
      // Derive contract_id from the matched charge if not already resolved above
      const { data: chargeRow } = await adminClient
        .from('charges')
        .select('contract_id')
        .eq('id', matchedChargeId)
        .eq('org_id', orgId)
        .single();
      contractId = (chargeRow?.contract_id as string | null) ?? null;
    }

    if (!contractId) {
      // Last resort: find any active contract for this tenant in this org
      const { data: activeContract } = await adminClient
        .from('contracts')
        .select('id')
        .eq('org_id', orgId)
        .eq('tenant_id', tenantId)
        .eq('status', 'active')
        .limit(1)
        .single();
      contractId = activeContract?.id ?? null;
    }

    if (!contractId) {
      // No active contract — cannot auto-approve; route to pending_review and notify admin
      log.warn('[receipt-handler] no active contract for tenant — routing to pending_review', { orgId, tenantId });

      const { error: insertErr } = await adminClient.from('payment_receipts').insert({
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
        status: 'pending_review',
      });

      if (insertErr?.code === '23505') {
        log.info('[receipt-handler] duplicate detected (no-contract path) — skipping', { orgId });
        return;
      }

      await notifyAdmin(adminClient, orgId, tenantId, confidence, 'no_active_contract');
      log.info('[receipt-handler] pending_review (no active contract)', { orgId });
      return;
    }

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

    // B1: If insert fails with 23505 (unique_violation), this is a duplicate — skip silently.
    // The UNIQUE(org_id, image_sha256) constraint is the authoritative dedupe gate.
    if (receiptErr?.code === '23505') {
      log.info('[receipt-handler] duplicate detected (auto-approve path) — skipping', { orgId });
      return;
    }

    if (receiptErr || !receipt) {
      log.error('[receipt-handler] insert receipt failed', { code: receiptErr?.code });
      return;
    }

    // Create payment row — contract_id is required (NOT NULL FK on payments table)
    const { data: payment, error: paymentErr } = await adminClient
      .from('payments')
      .insert({
        org_id: orgId,
        contract_id: contractId,
        tenant_id: tenantId,
        amount: safeAmount,
        status: 'approved',
        method: 'transfer',
        paid_at: ocrResult.data.date ?? new Date().toISOString().slice(0, 10),
        reference: `WA-OCR-${receipt.id.slice(0, 8)}`,
        approved_at: new Date().toISOString(),
      })
      .select('id')
      .single();

    if (paymentErr || !payment) {
      log.error('[receipt-handler] insert payment failed', { code: paymentErr?.code });
      // Receipt already inserted as auto_approved — update to pending_review to reflect reality
      await adminClient
        .from('payment_receipts')
        .update({ status: 'pending_review' })
        .eq('id', receipt.id);
      return;
    }

    // Link receipt to the created payment row (use the returned ID — no secondary SELECT needed)
    await adminClient
      .from('payment_receipts')
      .update({ matched_payment_id: payment.id })
      .eq('id', receipt.id);

    log.info('[receipt-handler] auto_approved', { orgId, receiptId: receipt.id });
  } else {
    // Insert as pending_review
    const { error: insertErr } = await adminClient.from('payment_receipts').insert({
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

    // B1: If insert fails with 23505, this is a duplicate — skip silently.
    if (insertErr?.code === '23505') {
      log.info('[receipt-handler] duplicate detected (pending_review path) — skipping', { orgId });
      return;
    }

    await notifyAdmin(adminClient, orgId, tenantId, confidence, 'below_threshold');
    log.info('[receipt-handler] pending_review', { orgId });
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function notifyAdmin(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  adminClient: any,
  orgId: string,
  tenantId: string,
  confidence: number | null | undefined,
  reason: 'below_threshold' | 'no_active_contract'
): Promise<void> {
  const { data: tenantRow } = await adminClient
    .from('tenants')
    .select('org_id, full_name')
    .eq('id', tenantId)
    .single();

  if (!tenantRow) return;

  const { data: adminProfile } = await adminClient
    .from('profiles')
    .select('id')
    .eq('org_id', orgId)
    .eq('role', 'admin')
    .limit(1)
    .single();

  if (!adminProfile) return;

  const reasonLabel =
    reason === 'no_active_contract'
      ? 'No active contract found'
      : `Low confidence: ${((confidence ?? 0) * 100).toFixed(0)}%`;

  await adminClient.from('notification_inbox').insert({
    org_id: orgId,
    profile_id: adminProfile.id,
    type: 'receipt_pending',
    title: 'Receipt Pending Review',
    body: `WhatsApp receipt from ${tenantRow.full_name} requires review (${reasonLabel})`,
    related_type: 'payment_receipt',
  });
}
