-- Migration 000037: additive self-service policy on tenant-avatars bucket
-- Allows a tenant to upload/update/delete their OWN avatar.
-- Path convention: {org_id}/{profile_id}/{uuid}.{ext}
-- The existing admin policy (added in migration 000024) is untouched — OR semantics.

CREATE POLICY "tenant_avatars_tenant_self_all"
  ON storage.objects FOR ALL TO authenticated
  USING (
    bucket_id = 'tenant-avatars'
    AND (storage.foldername(name))[2] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'tenant-avatars'
    AND (storage.foldername(name))[2] = auth.uid()::text
  );
