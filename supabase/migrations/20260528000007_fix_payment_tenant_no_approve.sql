-- =============================================================================
-- Migration 007: Close tenant payment-approval privilege escalation
--
-- Vulnerability confirmed by live RLS isolation test:
--   A tenant could call `.update({ status: 'approved' })` on their own payment
--   and the write succeeded. Root cause: although migration 003 defined no
--   explicit UPDATE policy for the `tenant` role, a permissive policy was
--   present in the live database (likely created via the Supabase dashboard
--   during a prior debugging/fix iteration, after migration 003 had already
--   run and its idempotent DROP loop had completed).
--
-- Fix (two-layer defense):
--
--   Layer 1 — RLS: Enumerate and DROP every conceivable tenant-permissive
--   UPDATE/ALL policy name on `payments`. Leaves only `payments_admin_update`
--   (which already requires `current_user_role() = 'admin'`).
--
--   Layer 2 — Trigger: BEFORE UPDATE trigger `trg_payments_no_tenant_approve`
--   that raises an exception if a non-admin attempts to change `status` to
--   'approved' OR to change `approved_by` / `approved_at`. This is DB-level
--   enforcement that survives any future accidental RLS policy addition.
--
-- IC13 compliance:
--   Tenants may RECORD a payment via INSERT (status must be 'pending' — enforced
--   by the existing `payments_tenant_insert` policy WITH CHECK (status = 'pending')
--   which is unchanged). Tenants may never UPDATE any payment row.
--
-- The INSERT policy WITH CHECK (status = 'pending') is confirmed correct in
-- migration 003 and is NOT touched here — it already prevents a tenant from
-- inserting a pre-approved payment.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Layer 1: DROP all possible tenant-permissive UPDATE / ALL policies on payments
-- (idempotent — IF EXISTS is safe if the policy never existed)
-- ---------------------------------------------------------------------------

-- Known potential permissive names from prior iterations or dashboard edits:
DROP POLICY IF EXISTS "payments_tenant_update"        ON public.payments;
DROP POLICY IF EXISTS "payments_tenant_update_own"    ON public.payments;
DROP POLICY IF EXISTS "payments_tenant_all"           ON public.payments;
DROP POLICY IF EXISTS "payments_tenant_record"        ON public.payments;
DROP POLICY IF EXISTS "payments_write"                ON public.payments;
DROP POLICY IF EXISTS "payments_all"                  ON public.payments;
DROP POLICY IF EXISTS "payments_tenant_own"           ON public.payments;

-- Belt-and-suspenders: drop ANY remaining UPDATE or ALL policy on payments
-- that is NOT the legitimate admin update policy.
DO $$
DECLARE
  pol RECORD;
BEGIN
  FOR pol IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'payments'
      AND policyname NOT IN (
            'payments_admin_read',
            'payments_admin_update',
            'payments_tenant_insert',
            'payments_tenant_read_own'
          )
      AND cmd IN ('UPDATE', 'ALL')
  LOOP
    RAISE NOTICE 'Dropping unexpected payments policy: %', pol.policyname;
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.payments', pol.policyname);
  END LOOP;
END;
$$;

-- ---------------------------------------------------------------------------
-- Layer 2: BEFORE UPDATE trigger — prevents non-admin from changing status,
-- approved_by, or approved_at regardless of RLS policy state
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.payments_guard_approval()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  caller_role TEXT;
BEGIN
  -- Read caller role from profiles (SECURITY DEFINER bypasses RLS so this always works)
  SELECT role INTO caller_role
  FROM public.profiles
  WHERE id = auth.uid();

  -- Allow admin unconditionally
  IF caller_role = 'admin' THEN
    RETURN NEW;
  END IF;

  -- Non-admin (tenant or unknown): raise if they try to change approval fields
  IF NEW.status     IS DISTINCT FROM OLD.status     AND NEW.status = 'approved' THEN
    RAISE EXCEPTION 'Insufficient privilege: only an admin may approve a payment'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'Insufficient privilege: tenants may not change payment status'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NEW.approved_by IS DISTINCT FROM OLD.approved_by THEN
    RAISE EXCEPTION 'Insufficient privilege: tenants may not set approved_by'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NEW.approved_at IS DISTINCT FROM OLD.approved_at THEN
    RAISE EXCEPTION 'Insufficient privilege: tenants may not set approved_at'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Also forbid changes to amount and paid_at on approved payments
  -- (a tenant must not be able to alter the financial record after it is approved)
  IF OLD.status = 'approved' THEN
    IF NEW.amount IS DISTINCT FROM OLD.amount THEN
      RAISE EXCEPTION 'Insufficient privilege: approved payment amount is immutable'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NEW.paid_at IS DISTINCT FROM OLD.paid_at THEN
      RAISE EXCEPTION 'Insufficient privilege: approved payment date is immutable'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Install the trigger (idempotent: drop first)
DROP TRIGGER IF EXISTS trg_payments_no_tenant_approve ON public.payments;

CREATE TRIGGER trg_payments_no_tenant_approve
  BEFORE UPDATE ON public.payments
  FOR EACH ROW
  EXECUTE FUNCTION public.payments_guard_approval();

-- ---------------------------------------------------------------------------
-- Verification comment:
--
-- After this migration the payments authorization story is:
--
--   INSERT  — tenant: payments_tenant_insert (WITH CHECK status='pending') ✓
--           — admin:  no explicit INSERT policy (service-role seed only) ✓
--   SELECT  — tenant: payments_tenant_read_own (own rows, any status)      ✓
--           — admin:  payments_admin_read (all org rows)                   ✓
--   UPDATE  — tenant: NO UPDATE policy + trigger blocks approval columns   ✓
--           — admin:  payments_admin_update (all org rows, no restriction) ✓
--   DELETE  — none (hard-delete disabled by design)                        ✓
--
-- IC13: Tenant records payment via INSERT (status='pending', enforced by
--       payments_tenant_insert WITH CHECK). Tenant cannot UPDATE status to
--       'approved' — blocked at two independent layers (RLS + trigger).
-- ---------------------------------------------------------------------------
