-- Migration 20260601000027: Extend tenant_tasks.status CHECK constraint
-- Adds 'awaiting_proof' and 'blocked_by_tenant' to the allowed status values.
-- The existing CHECK constraint must be dropped first (Postgres cannot alter CHECK in-place).

DO $$
DECLARE
  v_constraint_name text;
BEGIN
  SELECT conname INTO v_constraint_name
  FROM   pg_constraint
  WHERE  conrelid = 'public.tenant_tasks'::regclass
    AND  contype  = 'c'
    AND  pg_get_constraintdef(oid) LIKE '%status%';

  IF v_constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.tenant_tasks DROP CONSTRAINT %I', v_constraint_name);
  END IF;
END $$;

ALTER TABLE public.tenant_tasks
  ADD CONSTRAINT tenant_tasks_status_check
  CHECK (status IN (
    'pending',
    'in_progress',
    'proof_pending_review',
    'completed',
    'expired',
    'cancelled',
    'awaiting_proof',
    'blocked_by_tenant'
  ));
