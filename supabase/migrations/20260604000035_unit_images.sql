-- =============================================================================
-- Migration 000035: Unit Images table + storage buckets + RLS
-- =============================================================================
-- Creates:
--   1. unit_images table with RLS (admin full, tenant read own unit)
--   2. unit-images storage bucket (private, 5MB, image-only)
--   3. unit-images storage RLS policies
--   4. tenant_self_* policies on tenant-avatars bucket (tenant self-service)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. unit_images table
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.unit_images (
  id            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID          NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  unit_id       UUID          NOT NULL REFERENCES public.units(id) ON DELETE CASCADE,
  storage_path  TEXT          NOT NULL UNIQUE,
  filename      TEXT          NOT NULL,
  mime_type     TEXT          NOT NULL CHECK (mime_type IN ('image/jpeg', 'image/png', 'image/webp')),
  size_bytes    INT           NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 5242880),
  width         INT           CHECK (width > 0),
  height        INT           CHECK (height > 0),
  is_cover      BOOLEAN       NOT NULL DEFAULT false,
  caption       TEXT          CHECK (length(caption) <= 500),
  sort_order    INT           NOT NULL DEFAULT 0,
  uploaded_by   UUID          NOT NULL REFERENCES public.profiles(id),
  uploaded_at   TIMESTAMPTZ   NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS unit_images_unit_id_idx
  ON public.unit_images (unit_id, sort_order);

CREATE INDEX IF NOT EXISTS unit_images_org_id_idx
  ON public.unit_images (org_id);

-- Partial unique index: enforces at most one cover image per unit at the DB level.
-- Only one row with is_cover = true can exist for each unit_id.
CREATE UNIQUE INDEX IF NOT EXISTS unit_images_one_cover_per_unit_idx
  ON public.unit_images (unit_id)
  WHERE is_cover = true;

-- ---------------------------------------------------------------------------
-- RLS on unit_images
-- ---------------------------------------------------------------------------

ALTER TABLE public.unit_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.unit_images FORCE ROW LEVEL SECURITY;

-- Admin can perform all operations on unit_images within their org
CREATE POLICY "unit_images_admin_all" ON public.unit_images
  FOR ALL TO authenticated
  USING (
    org_id = public.current_org_id()
    AND public.current_user_role() = 'admin'
  )
  WITH CHECK (
    org_id = public.current_org_id()
    AND public.current_user_role() = 'admin'
  );

-- Tenant can only SELECT images for units they occupy (via tenants.unit_id where active)
CREATE POLICY "unit_images_tenant_read" ON public.unit_images
  FOR SELECT TO authenticated
  USING (
    org_id = public.current_org_id()
    AND public.current_user_role() = 'tenant'
    AND unit_id IN (
      SELECT unit_id FROM public.tenants
      WHERE profile_id = auth.uid()
        AND org_id = public.current_org_id()
        AND unit_id IS NOT NULL
    )
  );

-- ---------------------------------------------------------------------------
-- 2. unit-images storage bucket
-- ---------------------------------------------------------------------------
-- NOTE: If this INSERT fails because the Supabase project has bucket creation
-- disabled via SQL, create it via the Supabase Dashboard:
--   unit-images: 5 MB limit, allowed types: image/jpeg, image/png, image/webp, public: false
-- Then re-run only the storage RLS policies below.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'unit-images',
  'unit-images',
  false,
  5242880,  -- 5 MB
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3. Storage RLS for unit-images bucket
-- Path convention: {org_id}/{unit_id}/{uuid}.{ext}
-- Admin: full access to org's prefix
-- Tenant: SELECT only for objects under their assigned unit's prefix
-- No anonymous access
-- ---------------------------------------------------------------------------

-- Admin: full access to all operations within their org's prefix
CREATE POLICY "unit_images_admin_all_storage" ON storage.objects
  FOR ALL
  USING (
    bucket_id = 'unit-images'
    AND public.current_user_role() = 'admin'
    AND (storage.foldername(name))[1] = public.current_org_id()::text
  )
  WITH CHECK (
    bucket_id = 'unit-images'
    AND public.current_user_role() = 'admin'
    AND (storage.foldername(name))[1] = public.current_org_id()::text
  );

-- Tenant: SELECT only for objects under their assigned unit's path
-- Path segment [1]=org_id, [2]=unit_id
CREATE POLICY "unit_images_tenant_select_storage" ON storage.objects
  FOR SELECT
  USING (
    bucket_id = 'unit-images'
    AND public.current_user_role() = 'tenant'
    AND (storage.foldername(name))[1] = public.current_org_id()::text
    AND (storage.foldername(name))[2] IN (
      SELECT unit_id::text FROM public.tenants
      WHERE profile_id = auth.uid()
        AND org_id = public.current_org_id()
        AND unit_id IS NOT NULL
    )
  );

-- ---------------------------------------------------------------------------
-- 4. Tenant self-write policies on tenant-avatars bucket
-- Tenants can INSERT/UPDATE/DELETE only their own avatar under
-- {org_id}/{their_tenant_id}/* — but NOT other tenants' paths.
-- ---------------------------------------------------------------------------

CREATE POLICY "tenant_self_insert" ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'tenant-avatars'
    AND public.current_user_role() = 'tenant'
    AND (storage.foldername(name))[1] = public.current_org_id()::text
    AND (storage.foldername(name))[2] IN (
      SELECT id::text FROM public.tenants
      WHERE profile_id = auth.uid()
        AND org_id = public.current_org_id()
    )
  );

CREATE POLICY "tenant_self_update" ON storage.objects
  FOR UPDATE
  USING (
    bucket_id = 'tenant-avatars'
    AND public.current_user_role() = 'tenant'
    AND (storage.foldername(name))[1] = public.current_org_id()::text
    AND (storage.foldername(name))[2] IN (
      SELECT id::text FROM public.tenants
      WHERE profile_id = auth.uid()
        AND org_id = public.current_org_id()
    )
  )
  WITH CHECK (
    bucket_id = 'tenant-avatars'
    AND public.current_user_role() = 'tenant'
    AND (storage.foldername(name))[1] = public.current_org_id()::text
    AND (storage.foldername(name))[2] IN (
      SELECT id::text FROM public.tenants
      WHERE profile_id = auth.uid()
        AND org_id = public.current_org_id()
    )
  );

CREATE POLICY "tenant_self_delete" ON storage.objects
  FOR DELETE
  USING (
    bucket_id = 'tenant-avatars'
    AND public.current_user_role() = 'tenant'
    AND (storage.foldername(name))[1] = public.current_org_id()::text
    AND (storage.foldername(name))[2] IN (
      SELECT id::text FROM public.tenants
      WHERE profile_id = auth.uid()
        AND org_id = public.current_org_id()
    )
  );

-- Tenant self SELECT (needed for signed URL generation from tenant-scoped client)
CREATE POLICY "tenant_self_select" ON storage.objects
  FOR SELECT
  USING (
    bucket_id = 'tenant-avatars'
    AND public.current_user_role() = 'tenant'
    AND (storage.foldername(name))[1] = public.current_org_id()::text
    AND (storage.foldername(name))[2] IN (
      SELECT id::text FROM public.tenants
      WHERE profile_id = auth.uid()
        AND org_id = public.current_org_id()
    )
  );
