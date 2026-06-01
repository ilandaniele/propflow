-- Migration 20260601000026: Create property_weekly_summaries table
-- Idempotency gate: UNIQUE(property_id, iso_week) prevents re-sends within the same ISO week.
-- RLS: org_id-scoped, admin-only.

CREATE TABLE public.property_weekly_summaries (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  property_id UUID NOT NULL REFERENCES public.properties(id)    ON DELETE CASCADE,
  iso_week    TEXT NOT NULL,                              -- e.g. '2026-W22'
  body        TEXT NOT NULL,                              -- Summary message body (no PII)
  sent_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(property_id, iso_week)
);

-- Enable RLS (deny-by-default)
ALTER TABLE public.property_weekly_summaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.property_weekly_summaries FORCE ROW LEVEL SECURITY;

-- Admin-only policy: full access within own org
CREATE POLICY "pws_admin_all" ON public.property_weekly_summaries
  FOR ALL
  USING     (org_id = current_org_id() AND current_user_role() = 'admin')
  WITH CHECK(org_id = current_org_id() AND current_user_role() = 'admin');
