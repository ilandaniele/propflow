-- =============================================================================
-- Migration 005: Fix storage upload RLS — verify incident UUID ownership (B2)
--
-- Problem: the incident_photos_upload policy only validated path segment 1
-- (org_id) but did NOT verify that segment 2 (incident UUID) belongs to an
-- actual incident owned by this org. This allowed phantom storage objects to
-- be created under arbitrary UUIDs.
--
-- Fix: DROP and recreate the upload policy adding an EXISTS subquery that
-- ensures the incident UUID in the path corresponds to a real incidents row
-- belonging to the current user's org.
-- =============================================================================

-- Drop the old upload policy (read and delete policies are unaffected)
DROP POLICY IF EXISTS "incident_photos_upload" ON storage.objects;

-- Recreate with incident ownership check on path segment 2
CREATE POLICY "incident_photos_upload" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'incident-photos'
    -- Path segment 1: must match the uploading user's org
    AND (storage.foldername(name))[1] = public.current_org_id()::TEXT
    -- Path segment 2: incident UUID must exist in public.incidents for this org
    AND EXISTS (
      SELECT 1
      FROM public.incidents i
      WHERE i.id::TEXT = (storage.foldername(name))[2]
        AND i.org_id = public.current_org_id()
    )
  );
