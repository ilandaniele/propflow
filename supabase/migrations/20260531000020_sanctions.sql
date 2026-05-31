-- Migration 000020: sanctions table
-- Admin proposes sanctions (monetary or warning), tenant can dispute.
-- On approval of monetary sanctions, a charge row is auto-created (via Server Action).
-- RLS is applied in migration 000023.

CREATE TABLE IF NOT EXISTS public.sanctions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  tenant_id       uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  proposed_by     uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  kind            text NOT NULL CHECK (kind IN ('monetary', 'warning')),
  title           text NOT NULL,
  reason          text NOT NULL,
  amount          numeric(12, 2),   -- required iff kind='monetary'
  status          text NOT NULL DEFAULT 'proposed'
                      CHECK (status IN (
                        'proposed',
                        'approved',
                        'rejected',
                        'disputed',
                        'resolved'
                      )),
  -- linked_charge_id is UNIQUE to prevent double-charge on double-click
  linked_charge_id uuid UNIQUE NULL REFERENCES public.charges(id) ON DELETE SET NULL,
  approved_by      uuid NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  approved_at      timestamptz,
  dispute_reason   text,
  disputed_at      timestamptz,
  resolution_note  text,
  resolved_at      timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),

  -- Business rule: monetary must have amount; warning must not
  CONSTRAINT sanctions_monetary_amount CHECK (kind <> 'monetary' OR amount IS NOT NULL),
  CONSTRAINT sanctions_warning_no_amount CHECK (kind <> 'warning' OR amount IS NULL)
);

CREATE INDEX IF NOT EXISTS idx_sanctions_org_status ON public.sanctions (org_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sanctions_tenant ON public.sanctions (tenant_id, created_at DESC);
