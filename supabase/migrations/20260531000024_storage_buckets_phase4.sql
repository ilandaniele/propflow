-- Migration 000024: Storage buckets for Phase 4
-- Creates tenant-avatars and task-proofs buckets (private, signed-URL only).
--
-- NOTE: If INSERT into storage.buckets fails because the Supabase project has
-- bucket creation disabled via SQL, create them via the Supabase Dashboard:
--   tenant-avatars: 2 MB limit, allowed types: image/jpeg, image/png, image/webp, public: false
--   task-proofs:    5 MB limit, allowed types: image/jpeg, image/png, image/webp, public: false
-- Then re-run only the RLS policy chunk below.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('tenant-avatars', 'tenant-avatars', false, 2097152,
   ARRAY['image/jpeg', 'image/png', 'image/webp']),
  ('task-proofs',    'task-proofs',    false, 5242880,
   ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- RLS on storage.objects for each new bucket
-- Path convention: {org_id}/{resource_id}/{uuid}.{ext}
-- Admin can do all operations; tenant cannot access directly (uses signed URLs via API).
-- ---------------------------------------------------------------------------

-- tenant-avatars: admin-only write; read is done via signed URL (no direct SELECT policy)
CREATE POLICY "avatar_admin_insert" ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'tenant-avatars'
    AND current_user_role() = 'admin'
    AND (storage.foldername(name))[1] = current_org_id()::text
  );

CREATE POLICY "avatar_admin_update" ON storage.objects
  FOR UPDATE
  USING (
    bucket_id = 'tenant-avatars'
    AND current_user_role() = 'admin'
    AND (storage.foldername(name))[1] = current_org_id()::text
  );

CREATE POLICY "avatar_admin_delete" ON storage.objects
  FOR DELETE
  USING (
    bucket_id = 'tenant-avatars'
    AND current_user_role() = 'admin'
    AND (storage.foldername(name))[1] = current_org_id()::text
  );

CREATE POLICY "avatar_admin_select" ON storage.objects
  FOR SELECT
  USING (
    bucket_id = 'tenant-avatars'
    AND current_user_role() = 'admin'
    AND (storage.foldername(name))[1] = current_org_id()::text
  );

-- task-proofs: admin full access; no direct tenant access (proofs submitted via webhook)
CREATE POLICY "taskproof_admin_all" ON storage.objects
  FOR ALL
  USING (
    bucket_id = 'task-proofs'
    AND current_user_role() = 'admin'
    AND (storage.foldername(name))[1] = current_org_id()::text
  )
  WITH CHECK (
    bucket_id = 'task-proofs'
    AND current_user_role() = 'admin'
    AND (storage.foldername(name))[1] = current_org_id()::text
  );
