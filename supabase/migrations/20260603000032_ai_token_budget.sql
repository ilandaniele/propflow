-- =============================================================================
-- Migration 032: ai_token_budget table
-- AC30 (LLM10): Per-org daily AI token budget to enforce $5/org/day cost ceiling.
-- Spec: ~50 000 tokens/day at claude-3-haiku pricing = $5/day (conservative cap).
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.ai_token_budget (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  day          DATE NOT NULL DEFAULT CURRENT_DATE,
  tokens_used  INT NOT NULL DEFAULT 0,
  cost_usd     NUMERIC(10, 4) NOT NULL DEFAULT 0,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT ai_token_budget_tokens_non_negative CHECK (tokens_used >= 0),
  CONSTRAINT ai_token_budget_cost_non_negative  CHECK (cost_usd >= 0)
);

-- (org_id, day) must be unique — one row per org per day
CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_token_budget_org_day
  ON public.ai_token_budget (org_id, day);

CREATE INDEX IF NOT EXISTS idx_ai_token_budget_org
  ON public.ai_token_budget (org_id, day DESC);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- AC29 / AC30: admin-scoped, org-isolated; no tenant access.
-- ---------------------------------------------------------------------------

ALTER TABLE public.ai_token_budget ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_token_budget FORCE ROW LEVEL SECURITY;

-- Admin of the org can read their org's budget row.
CREATE POLICY "ai_budget_admin_select"
  ON public.ai_token_budget
  FOR SELECT
  USING (
    org_id = (SELECT org_id FROM public.profiles WHERE id = auth.uid() LIMIT 1)
    AND EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- Admin can insert a new day row for their org.
CREATE POLICY "ai_budget_admin_insert"
  ON public.ai_token_budget
  FOR INSERT
  WITH CHECK (
    org_id = (SELECT org_id FROM public.profiles WHERE id = auth.uid() LIMIT 1)
    AND EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- Admin can update tokens_used / cost_usd for their own org's row.
CREATE POLICY "ai_budget_admin_update"
  ON public.ai_token_budget
  FOR UPDATE
  USING (
    org_id = (SELECT org_id FROM public.profiles WHERE id = auth.uid() LIMIT 1)
    AND EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  )
  WITH CHECK (
    org_id = (SELECT org_id FROM public.profiles WHERE id = auth.uid() LIMIT 1)
    AND EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- Service-role operations (cron, budget enforcement, route handlers):
-- Service role bypasses RLS entirely — no policy needed for it.
-- The route handlers use the user-scoped createClient() so the above policies apply.
-- Budget enforcement functions use createAdminClient() for the atomic upsert
-- to avoid race conditions on concurrent requests.
