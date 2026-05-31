/**
 * Reusable OCR extraction function.
 * Extracted from /api/receipts/ocr/route.ts so it can be reused by the WhatsApp receipt handler.
 * LLM01: image + fixed system prompt; user text never concatenated.
 * LLM02: output strictly parsed via OcrExtractedSchema.
 */

import Anthropic from '@anthropic-ai/sdk';
import { assertServerEnv } from '@/lib/env';
import { OcrExtractedSchema, type OcrExtracted } from '@/lib/schemas/finance';
import { log } from '@/lib/log';

const OCR_TIMEOUT_MS = 25_000;

export interface RunOcrInput {
  imageBase64: string;
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';
  /** Context tag for logs (never includes PII) */
  contextTag?: string;
}

export type OcrResult =
  | { success: true; data: OcrExtracted }
  | { success: false; error: string };

/**
 * Run Claude vision OCR on a base64-encoded image.
 * Returns extracted amount, date, vendor, confidence or an error.
 */
export async function runOcr(input: RunOcrInput): Promise<OcrResult> {
  const { imageBase64, mimeType, contextTag = 'ocr' } = input;

  const apiKey = assertServerEnv('ANTHROPIC_API_KEY', 'receipt OCR');
  const anthropic = new Anthropic({ apiKey });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OCR_TIMEOUT_MS);

  try {
    const response = await anthropic.messages.create(
      {
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
                  data: imageBase64,
                },
              },
            ],
          },
        ],
      },
      { signal: controller.signal }
    );
    clearTimeout(timeout);

    const text = response.content[0]?.type === 'text' ? response.content[0].text : '{}';
    const cleaned = text.replace(/```json?\n?/g, '').replace(/```/g, '').trim();

    let raw: unknown;
    try {
      raw = JSON.parse(cleaned);
    } catch {
      log.warn(`[${contextTag}] JSON parse failed`, {});
      return { success: false, error: 'JSON parse failed' };
    }

    const parsed = OcrExtractedSchema.safeParse(raw);
    if (!parsed.success) {
      log.warn(`[${contextTag}] schema validation failed`, {});
      return { success: false, error: 'Schema validation failed' };
    }

    return { success: true, data: parsed.data };
  } catch (e) {
    clearTimeout(timeout);
    const msg = e instanceof Error ? e.name : 'unknown';
    log.error(`[${contextTag}] OCR failed`, { error: msg });
    return { success: false, error: 'OCR extraction failed' };
  }
}
