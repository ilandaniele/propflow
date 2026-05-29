-- Migration 000016: Storage buckets receipts + contracts + storage RLS policies
-- Phase 2 — Module 1 (receipts) + Module 2 (contracts PDF + signature images)

-- ── receipts bucket ───────────────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'receipts',
  'receipts',
  false,
  5242880,  -- 5 MB
  ARRAY['image/png', 'image/jpeg', 'image/webp', 'application/pdf']
)
ON CONFLICT (id) DO NOTHING;

-- receipts: upload — uploader must be authenticated + path segment 1 = org_id
CREATE POLICY receipts_upload ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'receipts'
    AND auth.role() = 'authenticated'
    AND (storage.foldername(name))[1] = public.current_org_id()::text
  );

-- receipts: read — org-scoped (signed URL via Route Handler; direct anon read blocked)
CREATE POLICY receipts_read ON storage.objects
  FOR SELECT
  USING (
    bucket_id = 'receipts'
    AND auth.role() = 'authenticated'
    AND (storage.foldername(name))[1] = public.current_org_id()::text
  );

-- receipts: delete — admin only
CREATE POLICY receipts_delete ON storage.objects
  FOR DELETE
  USING (
    bucket_id = 'receipts'
    AND auth.role() = 'authenticated'
    AND (storage.foldername(name))[1] = public.current_org_id()::text
    AND public.current_user_role() = 'admin'
  );

-- ── contracts bucket ──────────────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'contracts',
  'contracts',
  false,
  10485760,  -- 10 MB
  ARRAY['application/pdf', 'image/png']
)
ON CONFLICT (id) DO NOTHING;

-- contracts: upload — admin only (PDFs generated server-side; signature images via service-role)
CREATE POLICY contracts_upload ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'contracts'
    AND auth.role() = 'authenticated'
    AND (storage.foldername(name))[1] = public.current_org_id()::text
    AND public.current_user_role() = 'admin'
  );

-- contracts: read — admin or the contract's tenant via signed URL Route Handler
CREATE POLICY contracts_read ON storage.objects
  FOR SELECT
  USING (
    bucket_id = 'contracts'
    AND auth.role() = 'authenticated'
    AND (storage.foldername(name))[1] = public.current_org_id()::text
  );

-- contracts: delete — admin only
CREATE POLICY contracts_delete ON storage.objects
  FOR DELETE
  USING (
    bucket_id = 'contracts'
    AND auth.role() = 'authenticated'
    AND (storage.foldername(name))[1] = public.current_org_id()::text
    AND public.current_user_role() = 'admin'
  );
