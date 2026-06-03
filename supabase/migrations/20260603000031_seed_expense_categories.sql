-- Migration 20260603000031: Seed standard expense categories (data seed only, no schema changes)
-- Inserts PropFlow standard categories into expense_categories for every existing org.
-- Uses INSERT ... ON CONFLICT DO NOTHING so re-running is safe.
-- IC7: Turn Cost / CapEx / Debt Service / Platform Fees are tracked via these seeded rows
--      that the existing expenses.category_id FK already supports.

DO $$
DECLARE
  org RECORD;
BEGIN
  FOR org IN SELECT id FROM public.organizations LOOP
    -- Gross Income family
    INSERT INTO public.expense_categories (id, org_id, name, color)
    VALUES (gen_random_uuid(), org.id, 'gross_income',      '#22c55e')
    ON CONFLICT (org_id, name) DO NOTHING;

    INSERT INTO public.expense_categories (id, org_id, name, color)
    VALUES (gen_random_uuid(), org.id, 'other_income',      '#86efac')
    ON CONFLICT (org_id, name) DO NOTHING;

    -- Fee / debt categories
    INSERT INTO public.expense_categories (id, org_id, name, color)
    VALUES (gen_random_uuid(), org.id, 'platform_fees',     '#f97316')
    ON CONFLICT (org_id, name) DO NOTHING;

    INSERT INTO public.expense_categories (id, org_id, name, color)
    VALUES (gen_random_uuid(), org.id, 'booking_fees',      '#fb923c')
    ON CONFLICT (org_id, name) DO NOTHING;

    INSERT INTO public.expense_categories (id, org_id, name, color)
    VALUES (gen_random_uuid(), org.id, 'debt_service',      '#ef4444')
    ON CONFLICT (org_id, name) DO NOTHING;

    -- Operating expense categories
    INSERT INTO public.expense_categories (id, org_id, name, color)
    VALUES (gen_random_uuid(), org.id, 'operating_expenses', '#94a3b8')
    ON CONFLICT (org_id, name) DO NOTHING;

    INSERT INTO public.expense_categories (id, org_id, name, color)
    VALUES (gen_random_uuid(), org.id, 'capex',             '#8b5cf6')
    ON CONFLICT (org_id, name) DO NOTHING;

    INSERT INTO public.expense_categories (id, org_id, name, color)
    VALUES (gen_random_uuid(), org.id, 'turn_costs',        '#0ea5e9')
    ON CONFLICT (org_id, name) DO NOTHING;

    INSERT INTO public.expense_categories (id, org_id, name, color)
    VALUES (gen_random_uuid(), org.id, 'cleaning',          '#67e8f9')
    ON CONFLICT (org_id, name) DO NOTHING;

    INSERT INTO public.expense_categories (id, org_id, name, color)
    VALUES (gen_random_uuid(), org.id, 'maintenance',       '#a3e635')
    ON CONFLICT (org_id, name) DO NOTHING;

    INSERT INTO public.expense_categories (id, org_id, name, color)
    VALUES (gen_random_uuid(), org.id, 'utilities',         '#facc15')
    ON CONFLICT (org_id, name) DO NOTHING;

    INSERT INTO public.expense_categories (id, org_id, name, color)
    VALUES (gen_random_uuid(), org.id, 'repairs',           '#f59e0b')
    ON CONFLICT (org_id, name) DO NOTHING;

    INSERT INTO public.expense_categories (id, org_id, name, color)
    VALUES (gen_random_uuid(), org.id, 'supplies',          '#d1d5db')
    ON CONFLICT (org_id, name) DO NOTHING;

    INSERT INTO public.expense_categories (id, org_id, name, color)
    VALUES (gen_random_uuid(), org.id, 'other_expenses',    '#6b7280')
    ON CONFLICT (org_id, name) DO NOTHING;
  END LOOP;
END;
$$;
