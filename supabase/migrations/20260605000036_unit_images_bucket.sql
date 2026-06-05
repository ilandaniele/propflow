-- Migration 000036: unit-images storage bucket + storage RLS policies

-- Create private bucket for unit images (5 MB limit, jpg/png/webp only)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'unit-images',
  'unit-images',
  false,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- Storage RLS: admin / manager — full access within their org folder
-- Path convention: {org_id}/{unit_id}/{uuid}.{ext}
CREATE POLICY "unit_images_storage_admin_all"
  ON storage.objects FOR ALL TO authenticated
  USING (
    bucket_id = 'unit-images'
    AND (storage.foldername(name))[1] IN (
      SELECT org_id::text FROM profiles
      WHERE id = auth.uid() AND role IN ('admin', 'manager')
    )
  )
  WITH CHECK (
    bucket_id = 'unit-images'
    AND (storage.foldername(name))[1] IN (
      SELECT org_id::text FROM profiles
      WHERE id = auth.uid() AND role IN ('admin', 'manager')
    )
  );

-- Storage RLS: tenant — SELECT only their own unit's folder (path[2] = unit_id)
CREATE POLICY "unit_images_storage_tenant_select"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'unit-images'
    AND (storage.foldername(name))[2] IN (
      SELECT unit_id::text FROM tenants
      WHERE profile_id = auth.uid() AND unit_id IS NOT NULL
    )
  );
