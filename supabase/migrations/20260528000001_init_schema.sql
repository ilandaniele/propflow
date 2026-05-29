-- =============================================================================
-- Migration 001: Initial Schema
-- Creates all domain tables with FK constraints, indexes, and CHECK constraints.
-- RLS is enabled in migration 002. DO NOT add RLS policies here.
-- =============================================================================

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ===========================================================================
-- organizations
-- ===========================================================================
CREATE TABLE IF NOT EXISTS public.organizations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  slug        TEXT UNIQUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ===========================================================================
-- profiles (1:1 with auth.users)
-- ===========================================================================
CREATE TABLE IF NOT EXISTS public.profiles (
  id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  org_id      UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  role        TEXT NOT NULL CHECK (role IN ('admin', 'tenant')),
  full_name   TEXT,          -- PII
  email       TEXT,          -- PII
  phone       TEXT,          -- PII
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_profiles_org_id ON public.profiles(org_id);
CREATE INDEX IF NOT EXISTS idx_profiles_org_role ON public.profiles(org_id, role);

-- ===========================================================================
-- properties
-- ===========================================================================
CREATE TABLE IF NOT EXISTS public.properties (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  address     TEXT,          -- PII-adjacent
  city        TEXT,
  country     TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_properties_org_id ON public.properties(org_id);

-- ===========================================================================
-- units
-- ===========================================================================
CREATE TABLE IF NOT EXISTS public.units (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  property_id           UUID NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  label                 TEXT NOT NULL,
  floor                 TEXT,
  bedrooms              INTEGER CHECK (bedrooms >= 0),
  monthly_rent_default  NUMERIC(12,2) CHECK (monthly_rent_default >= 0),
  status                TEXT NOT NULL DEFAULT 'vacant' CHECK (status IN ('vacant', 'occupied')),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_units_org_id ON public.units(org_id);
CREATE INDEX IF NOT EXISTS idx_units_property_id ON public.units(property_id);

-- ===========================================================================
-- tenants
-- ===========================================================================
CREATE TABLE IF NOT EXISTS public.tenants (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  profile_id  UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  full_name   TEXT NOT NULL,  -- PII
  email       TEXT,           -- PII
  phone       TEXT,           -- PII
  unit_id     UUID REFERENCES public.units(id) ON DELETE SET NULL,
  notes       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tenants_org_id ON public.tenants(org_id);
CREATE INDEX IF NOT EXISTS idx_tenants_org_unit ON public.tenants(org_id, unit_id);
CREATE INDEX IF NOT EXISTS idx_tenants_profile_id ON public.tenants(profile_id);

-- ===========================================================================
-- contracts
-- ===========================================================================
CREATE TABLE IF NOT EXISTS public.contracts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  tenant_id         UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  unit_id           UUID NOT NULL REFERENCES public.units(id) ON DELETE CASCADE,
  start_date        DATE NOT NULL,
  end_date          DATE NOT NULL,
  monthly_rent      NUMERIC(12,2) NOT NULL CHECK (monthly_rent > 0),
  status            TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'terminated')),
  deposit           NUMERIC(12,2) CHECK (deposit >= 0),
  -- Future-proofing (unused this run — reserved for PDF + e-signature feature)
  document_url      TEXT,
  signed_at         TIMESTAMPTZ,
  signature_status  TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT contracts_date_order CHECK (end_date > start_date)
);

CREATE INDEX IF NOT EXISTS idx_contracts_org_id ON public.contracts(org_id);
CREATE INDEX IF NOT EXISTS idx_contracts_tenant_id ON public.contracts(tenant_id);
CREATE INDEX IF NOT EXISTS idx_contracts_unit_id ON public.contracts(unit_id);
CREATE INDEX IF NOT EXISTS idx_contracts_org_status ON public.contracts(org_id, status);

-- ===========================================================================
-- charges (what the tenant owes)
-- ===========================================================================
CREATE TABLE IF NOT EXISTS public.charges (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  contract_id  UUID NOT NULL REFERENCES public.contracts(id) ON DELETE CASCADE,
  tenant_id    UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  period       DATE,
  description  TEXT,
  amount       NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  due_date     DATE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_charges_org_id ON public.charges(org_id);
CREATE INDEX IF NOT EXISTS idx_charges_contract_id ON public.charges(contract_id);
CREATE INDEX IF NOT EXISTS idx_charges_tenant_period ON public.charges(tenant_id, period);

-- ===========================================================================
-- payments (what the tenant paid)
-- ===========================================================================
CREATE TABLE IF NOT EXISTS public.payments (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  contract_id  UUID NOT NULL REFERENCES public.contracts(id) ON DELETE CASCADE,
  tenant_id    UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  amount       NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  paid_at      DATE NOT NULL,
  method       TEXT NOT NULL DEFAULT 'transfer' CHECK (method IN ('cash', 'transfer', 'card', 'other')),
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved')),
  approved_by  UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  approved_at  TIMESTAMPTZ,
  reference    TEXT,  -- PII-adjacent: reference code, NOT card numbers
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payments_org_id ON public.payments(org_id);
CREATE INDEX IF NOT EXISTS idx_payments_contract_id ON public.payments(contract_id);
CREATE INDEX IF NOT EXISTS idx_payments_tenant_id ON public.payments(tenant_id);
CREATE INDEX IF NOT EXISTS idx_payments_org_status ON public.payments(org_id, status);

-- ===========================================================================
-- incidents
-- ===========================================================================
CREATE TABLE IF NOT EXISTS public.incidents (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  unit_id       UUID REFERENCES public.units(id) ON DELETE SET NULL,
  property_id   UUID REFERENCES public.properties(id) ON DELETE SET NULL,
  created_by    UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  tenant_id     UUID REFERENCES public.tenants(id) ON DELETE SET NULL,
  assigned_to   UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  category      TEXT NOT NULL CHECK (category IN ('plumbing','electrical','appliance','structural','cleaning','other')),
  title         TEXT NOT NULL,
  description   TEXT NOT NULL,
  priority      TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high','urgent')),
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','in_progress','solved')),
  photo_path    TEXT,
  resolved_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_incidents_org_id ON public.incidents(org_id);
CREATE INDEX IF NOT EXISTS idx_incidents_org_status ON public.incidents(org_id, status);
CREATE INDEX IF NOT EXISTS idx_incidents_created_by ON public.incidents(created_by);
CREATE INDEX IF NOT EXISTS idx_incidents_assigned_to ON public.incidents(assigned_to);

-- ===========================================================================
-- incident_comments
-- ===========================================================================
CREATE TABLE IF NOT EXISTS public.incident_comments (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  incident_id  UUID NOT NULL REFERENCES public.incidents(id) ON DELETE CASCADE,
  author_id    UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  body         TEXT NOT NULL CHECK (char_length(body) > 0),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_incident_comments_org_id ON public.incident_comments(org_id);
CREATE INDEX IF NOT EXISTS idx_incident_comments_incident_time ON public.incident_comments(incident_id, created_at);

-- ===========================================================================
-- updated_at trigger (auto-maintained)
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['organizations','profiles','properties','units','tenants','contracts','charges','payments','incidents','incident_comments']
  LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS trg_set_updated_at ON public.%I;
       CREATE TRIGGER trg_set_updated_at
         BEFORE UPDATE ON public.%I
         FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();',
      tbl, tbl
    );
  END LOOP;
END;
$$;
