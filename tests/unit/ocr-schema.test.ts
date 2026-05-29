import { describe, it, expect } from 'vitest';
import { OcrExtractedSchema } from '@/lib/schemas/finance';

describe('OcrExtractedSchema (OCR JSON Zod parsing)', () => {
  it('parses a valid extraction result', () => {
    const result = OcrExtractedSchema.safeParse({
      amount: 123.45,
      date: '2026-05-15',
      vendor: 'Home Depot',
      confidence: 0.92,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.amount).toBe(123.45);
      expect(result.data.date).toBe('2026-05-15');
      expect(result.data.vendor).toBe('Home Depot');
      expect(result.data.confidence).toBe(0.92);
    }
  });

  it('accepts null fields gracefully (LLM02 — partial extraction)', () => {
    const result = OcrExtractedSchema.safeParse({
      amount: null,
      date: null,
      vendor: null,
      confidence: null,
    });
    expect(result.success).toBe(true);
  });

  it('accepts missing fields', () => {
    const result = OcrExtractedSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('rejects confidence > 1.0', () => {
    const result = OcrExtractedSchema.safeParse({ confidence: 1.5 });
    expect(result.success).toBe(false);
  });

  it('rejects confidence < 0', () => {
    const result = OcrExtractedSchema.safeParse({ confidence: -0.1 });
    expect(result.success).toBe(false);
  });

  it('rejects negative amounts', () => {
    const result = OcrExtractedSchema.safeParse({ amount: -50 });
    expect(result.success).toBe(false);
  });

  it('rejects invalid date format', () => {
    const result = OcrExtractedSchema.safeParse({ date: '15/05/2026' }); // wrong format
    expect(result.success).toBe(false);
  });
});
