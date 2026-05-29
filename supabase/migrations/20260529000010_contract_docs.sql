-- Migration 000010: contract_templates + pricing_tables + indexes
-- Phase 2 — Module 2: Contract Completion

-- ── contract_templates ────────────────────────────────────────────────────────
CREATE TABLE public.contract_templates (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name           text NOT NULL,
  body_markdown  text NOT NULL,
  variables      jsonb NOT NULL DEFAULT '[]',
  created_at     timestamptz DEFAULT now() NOT NULL,
  updated_at     timestamptz DEFAULT now() NOT NULL,
  UNIQUE (org_id, name)
);

CREATE INDEX idx_contract_templates_org ON public.contract_templates(org_id);

-- ── pricing_tables (RTABLES) ──────────────────────────────────────────────────
CREATE TABLE public.pricing_tables (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name          text NOT NULL,
  property_type text NOT NULL,
  market_zone   text NOT NULL,
  -- tiers: [{label, bedrooms, min_rent, max_rent, suggested_rent}]
  tiers         jsonb NOT NULL DEFAULT '[]',
  created_at    timestamptz DEFAULT now() NOT NULL,
  updated_at    timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX idx_pricing_tables_org      ON public.pricing_tables(org_id);
CREATE INDEX idx_pricing_tables_org_type ON public.pricing_tables(org_id, property_type, market_zone);

CREATE TRIGGER trg_contract_templates_updated
  BEFORE UPDATE ON public.contract_templates
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_pricing_tables_updated
  BEFORE UPDATE ON public.pricing_tables
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
