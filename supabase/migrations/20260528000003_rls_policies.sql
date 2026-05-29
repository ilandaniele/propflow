-- =============================================================================
-- Migration 003: Row Level Security Policies
--
-- Design principles:
-- 1. ORG ISOLATION (PRIMARY): every domain table uses org_id = current_org_id()
-- 2. ROLE SEPARATION: admin gets full CRUD within org; tenant gets scoped reads
-- 3. PAYMENT APPROVAL: only admin can set status='approved'
-- 4. INCIDENT SOLVED: only admin can set status='solved'
-- 5. IDOR: cross-org queries return 0 rows (not errors) — app returns 404
-- 6. WITH CHECK: prevents cross-org inserts/updates
-- =============================================================================

-- Drop existing policies (idempotent re-apply)
DO $$
DECLARE
  pol RECORD;
BEGIN
  FOR pol IN
    SELECT policyname, tablename
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('organizations','profiles','properties','units','tenants',
                        'contracts','charges','payments','incidents','incident_comments')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol.policyname, pol.tablename);
  END LOOP;
END;
$$;

-- ===========================================================================
-- organizations
-- ===========================================================================

-- Users can only read their own org
CREATE POLICY "org_read_own" ON public.organizations
  FOR SELECT TO authenticated
  USING (id = public.current_org_id());

-- No direct inserts/updates from user traffic (provisioned via seed/admin)

-- ===========================================================================
-- profiles
-- ===========================================================================

-- Users can read their own profile; admins read all profiles in their org
CREATE POLICY "profiles_read" ON public.profiles
  FOR SELECT TO authenticated
  USING (
    id = auth.uid()
    OR (org_id = public.current_org_id() AND public.current_user_role() = 'admin')
  );

-- Users can update only their own profile
CREATE POLICY "profiles_update_own" ON public.profiles
  FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid() AND org_id = public.current_org_id());

-- Service-role inserts handled by seed/admin scripts (no policy needed for that key)
-- Anon/authenticated insert allowed only via trigger path (Supabase Auth hook)

-- ===========================================================================
-- properties
-- ===========================================================================

-- Admins can read and write properties in their org
CREATE POLICY "properties_admin_all" ON public.properties
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id() AND public.current_user_role() = 'admin')
  WITH CHECK (org_id = public.current_org_id() AND public.current_user_role() = 'admin');

-- Tenants cannot directly read properties (they access via contract/unit join if needed)

-- ===========================================================================
-- units
-- ===========================================================================

-- Admins can fully manage units in their org
CREATE POLICY "units_admin_all" ON public.units
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id() AND public.current_user_role() = 'admin')
  WITH CHECK (org_id = public.current_org_id() AND public.current_user_role() = 'admin');

-- Tenants can only read the unit referenced by their active contract
CREATE POLICY "units_tenant_read_own" ON public.units
  FOR SELECT TO authenticated
  USING (
    public.current_user_role() = 'tenant'
    AND id IN (
      SELECT c.unit_id FROM public.contracts c
      JOIN public.tenants t ON t.id = c.tenant_id
      WHERE t.profile_id = auth.uid()
        AND c.status = 'active'
        AND c.org_id = public.current_org_id()
    )
  );

-- ===========================================================================
-- tenants
-- ===========================================================================

-- Admins can fully manage tenants in their org
CREATE POLICY "tenants_admin_all" ON public.tenants
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id() AND public.current_user_role() = 'admin')
  WITH CHECK (org_id = public.current_org_id() AND public.current_user_role() = 'admin');

-- A tenant can read only their own tenant row
CREATE POLICY "tenants_read_own" ON public.tenants
  FOR SELECT TO authenticated
  USING (
    public.current_user_role() = 'tenant'
    AND profile_id = auth.uid()
    AND org_id = public.current_org_id()
  );

-- ===========================================================================
-- contracts
-- ===========================================================================

-- Admins can fully manage contracts in their org
CREATE POLICY "contracts_admin_all" ON public.contracts
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id() AND public.current_user_role() = 'admin')
  WITH CHECK (org_id = public.current_org_id() AND public.current_user_role() = 'admin');

-- Tenants can read only contracts where they are the tenant
CREATE POLICY "contracts_tenant_read_own" ON public.contracts
  FOR SELECT TO authenticated
  USING (
    public.current_user_role() = 'tenant'
    AND org_id = public.current_org_id()
    AND tenant_id IN (
      SELECT id FROM public.tenants
      WHERE profile_id = auth.uid()
        AND org_id = public.current_org_id()
    )
  );

-- ===========================================================================
-- charges
-- ===========================================================================

-- Admins can fully manage charges in their org
CREATE POLICY "charges_admin_all" ON public.charges
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id() AND public.current_user_role() = 'admin')
  WITH CHECK (org_id = public.current_org_id() AND public.current_user_role() = 'admin');

-- Tenants can read only their own charges
CREATE POLICY "charges_tenant_read_own" ON public.charges
  FOR SELECT TO authenticated
  USING (
    public.current_user_role() = 'tenant'
    AND org_id = public.current_org_id()
    AND tenant_id IN (
      SELECT id FROM public.tenants
      WHERE profile_id = auth.uid()
        AND org_id = public.current_org_id()
    )
  );

-- ===========================================================================
-- payments
-- ===========================================================================

-- Admins can read all payments in their org; only admins can approve
CREATE POLICY "payments_admin_read" ON public.payments
  FOR SELECT TO authenticated
  USING (org_id = public.current_org_id() AND public.current_user_role() = 'admin');

-- Admins can update (approve) payments in their org; status must go to 'approved'
-- Tenants CANNOT set status='approved' — enforced here AND in Server Action guard
CREATE POLICY "payments_admin_update" ON public.payments
  FOR UPDATE TO authenticated
  USING (org_id = public.current_org_id() AND public.current_user_role() = 'admin')
  WITH CHECK (org_id = public.current_org_id() AND public.current_user_role() = 'admin');

-- Tenants can insert payments only for their own contracts, always as 'pending'
CREATE POLICY "payments_tenant_insert" ON public.payments
  FOR INSERT TO authenticated
  WITH CHECK (
    public.current_user_role() = 'tenant'
    AND org_id = public.current_org_id()
    AND status = 'pending'
    AND tenant_id IN (
      SELECT id FROM public.tenants
      WHERE profile_id = auth.uid()
        AND org_id = public.current_org_id()
    )
    AND contract_id IN (
      SELECT c.id FROM public.contracts c
      JOIN public.tenants t ON t.id = c.tenant_id
      WHERE t.profile_id = auth.uid()
        AND c.org_id = public.current_org_id()
    )
  );

-- Tenants can read only their own payments
CREATE POLICY "payments_tenant_read_own" ON public.payments
  FOR SELECT TO authenticated
  USING (
    public.current_user_role() = 'tenant'
    AND org_id = public.current_org_id()
    AND tenant_id IN (
      SELECT id FROM public.tenants
      WHERE profile_id = auth.uid()
        AND org_id = public.current_org_id()
    )
  );

-- ===========================================================================
-- incidents
-- ===========================================================================

-- Admins can fully manage incidents in their org
CREATE POLICY "incidents_admin_all" ON public.incidents
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id() AND public.current_user_role() = 'admin')
  WITH CHECK (org_id = public.current_org_id() AND public.current_user_role() = 'admin');

-- Tenants can insert incidents for their org
CREATE POLICY "incidents_tenant_insert" ON public.incidents
  FOR INSERT TO authenticated
  WITH CHECK (
    public.current_user_role() = 'tenant'
    AND org_id = public.current_org_id()
    AND created_by = auth.uid()
    AND status = 'pending'  -- tenants always start as pending
  );

-- Tenants can read incidents they created or are the affected tenant
CREATE POLICY "incidents_tenant_read_own" ON public.incidents
  FOR SELECT TO authenticated
  USING (
    public.current_user_role() = 'tenant'
    AND org_id = public.current_org_id()
    AND (
      created_by = auth.uid()
      OR tenant_id IN (
        SELECT id FROM public.tenants
        WHERE profile_id = auth.uid()
          AND org_id = public.current_org_id()
      )
    )
  );

-- Tenants CANNOT update incidents (no status changes — admin-only)
-- No UPDATE policy for tenants on incidents

-- ===========================================================================
-- incident_comments
-- ===========================================================================

-- Admins can read and write all comments on org incidents
CREATE POLICY "comments_admin_all" ON public.incident_comments
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id() AND public.current_user_role() = 'admin')
  WITH CHECK (org_id = public.current_org_id() AND public.current_user_role() = 'admin');

-- Tenants can read comments on incidents they can read
CREATE POLICY "comments_tenant_read" ON public.incident_comments
  FOR SELECT TO authenticated
  USING (
    public.current_user_role() = 'tenant'
    AND org_id = public.current_org_id()
    AND incident_id IN (
      SELECT id FROM public.incidents
      WHERE org_id = public.current_org_id()
        AND (
          created_by = auth.uid()
          OR tenant_id IN (
            SELECT id FROM public.tenants
            WHERE profile_id = auth.uid()
              AND org_id = public.current_org_id()
          )
        )
    )
  );

-- Tenants can insert comments on incidents they can read
CREATE POLICY "comments_tenant_insert" ON public.incident_comments
  FOR INSERT TO authenticated
  WITH CHECK (
    public.current_user_role() = 'tenant'
    AND org_id = public.current_org_id()
    AND author_id = auth.uid()
    AND incident_id IN (
      SELECT id FROM public.incidents
      WHERE org_id = public.current_org_id()
        AND (
          created_by = auth.uid()
          OR tenant_id IN (
            SELECT id FROM public.tenants
            WHERE profile_id = auth.uid()
              AND org_id = public.current_org_id()
          )
        )
    )
  );
