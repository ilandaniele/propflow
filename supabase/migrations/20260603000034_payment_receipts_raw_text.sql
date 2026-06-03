-- Migration 000034: add raw_text column to payment_receipts
-- raw_text stores the full OCR output from the WhatsApp receipt image.
-- Column is nullable: older rows pre-dating OCR integration have NULL here.

ALTER TABLE public.payment_receipts
  ADD COLUMN IF NOT EXISTS raw_text text;

COMMENT ON COLUMN public.payment_receipts.raw_text
  IS 'Full OCR extracted text from the receipt image. NULL for rows created before OCR was integrated.';
