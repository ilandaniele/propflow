-- =============================================================================
-- Migration 002: RLS Helper Functions + ENABLE / FORCE RLS on all tables
-- DENY-BY-DEFAULT: enabling RLS without policies = no access.
-- Policies are added in migration 003.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Helper: current_org_id()
-- Returns the org_id of the currently authenticated user's profile.
-- SECURITY DEFINER + search_path to prevent schema injection.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.current_org_id()
RETURNS UUID
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT org_id FROM public.profiles WHERE id = auth.uid();
$$;

-- ---------------------------------------------------------------------------
-- Helper: current_user_role()
-- Returns the role ('admin' or 'tenant') of the currently authenticated user.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS TEXT
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid();
$$;

-- ---------------------------------------------------------------------------
-- Enable Row Level Security on every domain table (deny-by-default)
-- FORCE RLS applies even to table owners (prevents accidental admin bypass)
-- ---------------------------------------------------------------------------

ALTER TABLE public.organizations      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.properties         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.units              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenants            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contracts          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.charges            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.incidents          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.incident_comments  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.organizations      FORCE ROW LEVEL SECURITY;
ALTER TABLE public.profiles           FORCE ROW LEVEL SECURITY;
ALTER TABLE public.properties         FORCE ROW LEVEL SECURITY;
ALTER TABLE public.units              FORCE ROW LEVEL SECURITY;
ALTER TABLE public.tenants            FORCE ROW LEVEL SECURITY;
ALTER TABLE public.contracts          FORCE ROW LEVEL SECURITY;
ALTER TABLE public.charges            FORCE ROW LEVEL SECURITY;
ALTER TABLE public.payments           FORCE ROW LEVEL SECURITY;
ALTER TABLE public.incidents          FORCE ROW LEVEL SECURITY;
ALTER TABLE public.incident_comments  FORCE ROW LEVEL SECURITY;
