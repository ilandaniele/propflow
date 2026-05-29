export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/guards';
import { Errors } from '@/lib/errors';
import { ocrRateLimit } from '@/lib/ratelimit';
import { assertServerEnv } from '@/lib/env';
import { OcrRequestSchema, OcrExtractedSchema } from '@/lib/schemas/finance';
import { log } from '@/lib/log';

const OCR_TIMEOUT_MS = 25_000; // 25s — Vercel function timeout is 60s

export async function POST(request: NextRequest): Promise<NextResponse> {
  // Auth guard (manual, like /api/incident-photo)
  let ctx;
  try { ctx = await requireUser(); } catch {
    return NextResponse.json(Errors.UNAUTHORIZED(), { status: 401 });
  }

  // Rate limit: 15/day/user + 500/day/org (fail-closed)
  const rl = ocrRateLimit(ctx.userId, ctx.orgId);
  if (!rl.success) {
    return NextResponse.json(Errors.RATE_LIMITED(), { status: 429 });
  }

  // Validate body
  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json(Errors.VALIDATION_ERROR({ formErrors: ['Invalid JSON'], fieldErrors: {} }), { status: 400 });
  }
  const parsed = OcrRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(Errors.VALIDATION_ERROR(parsed.error.flatten()), { status: 400 });
  }

  const supabase = await createClient();

  // Load the receipt row — must belong to this org
  const { data: receipt } = await supabase
    .from('receipt_uploads')
    .select('id, file_path, ocr_status, org_id')
    .eq('id', parsed.data.receipt_id)
    .eq('org_id', ctx.orgId)
    .single();

  if (!receipt) {
    return NextResponse.json(Errors.NOT_FOUND(), { status: 404 });
  }

  // Only re-run OCR on pending/failed; skip already extracted/matched
  if (receipt.ocr_status === 'extracted' || receipt.ocr_status === 'matched') {
    return NextResponse.json({ status: 'already_extracted' });
  }

  // Mark as processing
  await supabase
    .from('receipt_uploads')
    .update({ ocr_status: 'processing', updated_at: new Date().toISOString() })
    .eq('id', receipt.id);

  try {
    // Get a short-TTL signed URL to the stored image
    const { data: urlData } = await supabase.storage
      .from('receipts')
      .createSignedUrl(receipt.file_path, 60); // 60-second TTL for the OCR call

    if (!urlData?.signedUrl) {
      throw new Error('Could not get signed URL for receipt');
    }

    // Fetch the image for Claude
    const imageRes = await fetch(urlData.signedUrl);
    if (!imageRes.ok) throw new Error('Could not fetch receipt image');

    const imageBuffer = await imageRes.arrayBuffer();
    const base64Image = Buffer.from(imageBuffer).toString('base64');
    const mimeType = (imageRes.headers.get('content-type') ?? 'image/jpeg') as
      | 'image/jpeg'
      | 'image/png'
      | 'image/webp'
      | 'image/gif';

    // Only image types supported by Claude vision; skip PDF (return partial)
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(mimeType)) {
      await supabase.from('receipt_uploads').update({
        ocr_status: 'failed',
        ocr_error: 'PDF OCR not supported at this time',
        updated_at: new Date().toISOString(),
      }).eq('id', receipt.id);
      return NextResponse.json({ status: 'failed', reason: 'unsupported_type' });
    }

    // Call Claude vision — LLM01: image + fixed system prompt; user text never concatenated
    const apiKey = assertServerEnv('ANTHROPIC_API_KEY', 'receipt OCR');
    const anthropic = new Anthropic({ apiKey });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), OCR_TIMEOUT_MS);

    let extractedRaw: unknown;
    try {
      const response = await anthropic.messages.create({
        model: 'claude-opus-4-5',
        max_tokens: 256,
        system: `You are a receipt data extraction service. Extract the total amount, date, and vendor name from the receipt image.
Respond ONLY with a JSON object with these exact fields: {"amount": number_or_null, "date": "YYYY-MM-DD_or_null", "vendor": "string_or_null", "confidence": 0.0_to_1.0}.
Do not include any other text. If a field cannot be determined, use null.`,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: mimeType,
                  data: base64Image,
                },
              },
            ],
          },
        ],
      });
      clearTimeout(timeout);

      // LLM02: parse as structured JSON, never use raw output as code/SQL
      const text = response.content[0]?.type === 'text' ? response.content[0].text : '{}';
      // Strip any markdown code fences Claude might add
      const cleaned = text.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
      extractedRaw = JSON.parse(cleaned);
    } catch (e) {
      clearTimeout(timeout);
      throw e;
    }

    const extracted = OcrExtractedSchema.safeParse(extractedRaw);

    await supabase.from('receipt_uploads').update({
      ocr_status: 'extracted',
      extracted_amount: extracted.success ? (extracted.data.amount ?? null) : null,
      extracted_date: extracted.success ? (extracted.data.date ?? null) : null,
      extracted_vendor: extracted.success ? (extracted.data.vendor ?? null) : null,
      confidence: extracted.success ? (extracted.data.confidence ?? null) : null,
      ocr_error: null,
      updated_at: new Date().toISOString(),
    }).eq('id', receipt.id);

    log.info('[ocr] extraction complete', { receiptId: receipt.id });
    return NextResponse.json({ status: 'extracted' });

  } catch (e) {
    // Fail-closed: always set failed status; never leak stack trace (A10)
    const msg = e instanceof Error ? e.message : 'unknown';
    log.error('[ocr] extraction failed', { receiptId: receipt.id, error: msg });

    await supabase.from('receipt_uploads').update({
      ocr_status: 'failed',
      ocr_error: 'Extraction failed. Please try again.',
      updated_at: new Date().toISOString(),
    }).eq('id', receipt.id);

    return NextResponse.json({ status: 'failed' });
  }
}
