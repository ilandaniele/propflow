-- =============================================================================
-- Migration 006: Tighten incidents INSERT RLS for tenant callers (B4)
--
-- Problem: the incidents_tenant_insert policy only validated org_id and
-- created_by = auth.uid(). It did NOT verify that the tenant_id column
-- (if supplied) matches the inserting user's own tenant row, allowing a
-- malicious tenant to attribute an incident to another tenant's UUID.
--
-- Fix: DROP and recreate the policy adding a check that tenant_id, when
-- provided, must belong to the authenticated user's own tenant row.
-- This is defense-in-depth — the Server Action (B4 fix) already derives
-- tenant_id server-side, but RLS is the last line of defense.
-- =============================================================================

DROP POLICY IF EXISTS "incidents_tenant_insert" ON public.incidents;

CREATE POLICY "incidents_tenant_insert" ON public.incidents
  FOR INSERT TO authenticated
  WITH CHECK (
    public.current_user_role() = 'tenant'
    AND org_id = public.current_org_id()
    AND created_by = auth.uid()
    AND status = 'pending'
    -- tenant_id must be null OR must match the authenticated user's own tenant row
    AND (
      tenant_id IS NULL
      OR tenant_id IN (
        SELECT id FROM public.tenants
        WHERE profile_id = auth.uid()
          AND org_id = public.current_org_id()
      )
    )
  );
