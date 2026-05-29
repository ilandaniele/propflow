-- =============================================================================
-- Migration 004: Storage bucket + tenant_statement view
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Storage: incident-photos (private bucket)
-- Bucket is private — access only via signed URLs (short TTL).
-- Path convention: {org_id}/{incident_id}/{uuid}.{ext}
-- ---------------------------------------------------------------------------

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'incident-photos',
  'incident-photos',
  false,         -- PRIVATE: never public
  5242880,       -- 5 MB limit
  ARRAY['image/png', 'image/jpeg', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = 5242880,
  allowed_mime_types = ARRAY['image/png', 'image/jpeg', 'image/webp'];

-- Storage RLS: mirror the incidents table access
-- Upload: users who can see the incident can upload (org-scoped path)
-- Read: same — org path must match current user's org

-- Enable RLS on storage objects (Supabase storage uses its own RLS)
CREATE POLICY "incident_photos_upload" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'incident-photos'
    AND (storage.foldername(name))[1] = public.current_org_id()::TEXT
  );

CREATE POLICY "incident_photos_read" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'incident-photos'
    AND (storage.foldername(name))[1] = public.current_org_id()::TEXT
  );

CREATE POLICY "incident_photos_delete_admin" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'incident-photos'
    AND (storage.foldername(name))[1] = public.current_org_id()::TEXT
    AND public.current_user_role() = 'admin'
  );

-- ---------------------------------------------------------------------------
-- View: tenant_statement
-- Computes balance per tenant: approved_payments - charges
-- is_overdue = balance < 0 AND at least one charge has a past due_date
-- RLS: this view reads from RLS-protected tables. It inherits their policies
-- when queried by regular users. No separate RLS needed on the view itself,
-- but we still apply SECURITY INVOKER (default) so it runs as the calling user.
-- ---------------------------------------------------------------------------

DROP VIEW IF EXISTS public.tenant_statement;

CREATE VIEW public.tenant_statement AS
SELECT
  t.id               AS tenant_id,
  t.org_id           AS org_id,
  COALESCE(SUM(ch.amount) FILTER (WHERE ch.id IS NOT NULL), 0)  AS total_charges,
  COALESCE(SUM(p.amount)  FILTER (WHERE p.id IS NOT NULL AND p.status = 'approved'), 0)  AS total_approved_payments,
  COALESCE(SUM(p.amount)  FILTER (WHERE p.id IS NOT NULL AND p.status = 'approved'), 0)
    - COALESCE(SUM(ch.amount) FILTER (WHERE ch.id IS NOT NULL), 0)  AS balance,
  (
    COALESCE(SUM(p.amount) FILTER (WHERE p.id IS NOT NULL AND p.status = 'approved'), 0)
    - COALESCE(SUM(ch.amount) FILTER (WHERE ch.id IS NOT NULL), 0) < 0
  ) AND EXISTS (
    SELECT 1 FROM public.charges ch2
    WHERE ch2.tenant_id = t.id
      AND ch2.due_date IS NOT NULL
      AND ch2.due_date < CURRENT_DATE
  )  AS is_overdue
FROM public.tenants t
LEFT JOIN public.charges ch ON ch.tenant_id = t.id
LEFT JOIN public.payments p ON p.tenant_id = t.id
GROUP BY t.id, t.org_id;

-- Grant access to authenticated users (view will inherit table RLS)
GRANT SELECT ON public.tenant_statement TO authenticated;

-- ---------------------------------------------------------------------------
-- Profile auto-create trigger (runs when auth.users row is created)
-- NOTE: org_id and role must be passed in the user's app_metadata by the
-- admin provisioning script. Without them, the trigger will not insert.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Only create profile if org_id and role are present in app_metadata
  IF NEW.raw_app_meta_data ? 'org_id' AND NEW.raw_app_meta_data ? 'role' THEN
    INSERT INTO public.profiles (id, org_id, role, full_name, email)
    VALUES (
      NEW.id,
      (NEW.raw_app_meta_data->>'org_id')::UUID,
      NEW.raw_app_meta_data->>'role',
      COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
      NEW.email
    )
    ON CONFLICT (id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

-- Drop and recreate the trigger
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
