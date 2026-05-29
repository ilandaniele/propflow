-- Migration 000008: expense_categories + expenses + indexes
-- Phase 2 — Module 1: Payment & Financial Intelligence

-- ── expense_categories ────────────────────────────────────────────────────────
CREATE TABLE public.expense_categories (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name       text NOT NULL,
  color      text NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  UNIQUE (org_id, name)
);

CREATE INDEX idx_expense_categories_org ON public.expense_categories(org_id);

-- ── expenses ──────────────────────────────────────────────────────────────────
CREATE TABLE public.expenses (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  property_id  uuid NULL REFERENCES public.properties(id) ON DELETE SET NULL,
  unit_id      uuid NULL REFERENCES public.units(id) ON DELETE SET NULL,
  category_id  uuid NULL REFERENCES public.expense_categories(id) ON DELETE SET NULL,
  amount       numeric(12,2) NOT NULL CHECK (amount > 0),
  description  text NOT NULL,
  incurred_on  date NOT NULL,
  receipt_path text NULL,
  created_at   timestamptz DEFAULT now() NOT NULL,
  updated_at   timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX idx_expenses_org         ON public.expenses(org_id);
CREATE INDEX idx_expenses_org_date    ON public.expenses(org_id, incurred_on);
CREATE INDEX idx_expenses_property    ON public.expenses(property_id);
CREATE INDEX idx_expenses_category    ON public.expenses(category_id);

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER trg_expense_categories_updated
  BEFORE UPDATE ON public.expense_categories
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_expenses_updated
  BEFORE UPDATE ON public.expenses
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
