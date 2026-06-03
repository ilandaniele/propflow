-- =============================================================================
-- Migration 030: CSV Import tables + mapping tables
-- AC17: csv_imports / import_rows tables for dry-run/commit workflow
-- AC18: committed_at field for commit confirmation
-- AC29 (partial): All 5 tables have ENABLE + FORCE RLS with WITH CHECK policies
-- =============================================================================

-- ---------------------------------------------------------------------------
-- csv_imports — one row per upload attempt (dry_run or committed)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.csv_imports (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  import_type       TEXT NOT NULL CHECK (import_type IN ('monthly_billed', 'monthly_collected', 'monthly_summary', 'room_performance')),
  original_filename TEXT NOT NULL,
  period            TEXT NOT NULL,                    -- YYYY-MM
  status            TEXT NOT NULL CHECK (status IN ('dry_run', 'committed', 'failed')),
  row_count         INT NOT NULL DEFAULT 0,
  failed_count      INT NOT NULL DEFAULT 0,
  error_summary     JSONB NOT NULL DEFAULT '[]',
  committed_at      TIMESTAMPTZ,
  created_by        UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for import log queries (most recent first per org)
CREATE INDEX IF NOT EXISTS idx_csv_imports_org_created
  ON public.csv_imports (org_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_csv_imports_org_status
  ON public.csv_imports (org_id, status);

-- ---------------------------------------------------------------------------
-- import_rows — one row per data row in a CSV, linked to csv_imports
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.import_rows (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  import_id       UUID NOT NULL REFERENCES public.csv_imports(id) ON DELETE CASCADE,
  row_number      INT NOT NULL,
  raw_data        JSONB NOT NULL,
  normalized_data JSONB,
  status          TEXT NOT NULL CHECK (status IN ('ok', 'warning', 'error')),
  error_detail    TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for efficient per-import row queries
CREATE INDEX IF NOT EXISTS idx_import_rows_import_id
  ON public.import_rows (import_id, row_number);

CREATE INDEX IF NOT EXISTS idx_import_rows_status
  ON public.import_rows (import_id, status);

-- ---------------------------------------------------------------------------
-- phantom_rooms — unmatched room labels → unit mapping
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.phantom_rooms (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  raw_room_label  TEXT NOT NULL,
  matched_unit_id UUID REFERENCES public.units(id) ON DELETE SET NULL,
  resolution      TEXT NOT NULL DEFAULT 'pending' CHECK (resolution IN ('pending', 'mapped', 'ignored')),
  resolved_by     UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  resolved_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT phantom_rooms_org_label_uq UNIQUE (org_id, raw_room_label)
);

CREATE INDEX IF NOT EXISTS idx_phantom_rooms_org_resolution
  ON public.phantom_rooms (org_id, resolution);

-- ---------------------------------------------------------------------------
-- property_mappings — external property name → internal property
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.property_mappings (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  external_name       TEXT NOT NULL,
  internal_property_id UUID REFERENCES public.properties(id) ON DELETE SET NULL,
  last_matched_at     TIMESTAMPTZ,
  created_by          UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  CONSTRAINT property_mappings_org_name_uq UNIQUE (org_id, external_name)
);

CREATE INDEX IF NOT EXISTS idx_property_mappings_org
  ON public.property_mappings (org_id);

-- ---------------------------------------------------------------------------
-- account_mappings — external accounting code → internal category
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.account_mappings (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  external_account      TEXT NOT NULL,
  internal_category     TEXT,
  is_income             BOOLEAN NOT NULL DEFAULT FALSE,
  affects_net_profit    BOOLEAN NOT NULL DEFAULT TRUE,
  created_by            UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  CONSTRAINT account_mappings_org_account_uq UNIQUE (org_id, external_account)
);

CREATE INDEX IF NOT EXISTS idx_account_mappings_org
  ON public.account_mappings (org_id);

-- =============================================================================
-- RLS: ENABLE + FORCE on all 5 tables
-- =============================================================================

ALTER TABLE public.csv_imports      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.csv_imports      FORCE ROW LEVEL SECURITY;

ALTER TABLE public.import_rows      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.import_rows      FORCE ROW LEVEL SECURITY;

ALTER TABLE public.phantom_rooms    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.phantom_rooms    FORCE ROW LEVEL SECURITY;

ALTER TABLE public.property_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.property_mappings FORCE ROW LEVEL SECURITY;

ALTER TABLE public.account_mappings  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_mappings  FORCE ROW LEVEL SECURITY;

-- =============================================================================
-- RLS Policies: csv_imports — admin-only, org-scoped
-- =============================================================================

CREATE POLICY "csv_imports_admin_select"
  ON public.csv_imports
  FOR SELECT
  USING (
    public.current_user_role() = 'admin'
    AND org_id = public.current_org_id()
  );

CREATE POLICY "csv_imports_admin_insert"
  ON public.csv_imports
  FOR INSERT
  WITH CHECK (
    public.current_user_role() = 'admin'
    AND org_id = public.current_org_id()
  );

CREATE POLICY "csv_imports_admin_update"
  ON public.csv_imports
  FOR UPDATE
  USING (
    public.current_user_role() = 'admin'
    AND org_id = public.current_org_id()
  )
  WITH CHECK (
    public.current_user_role() = 'admin'
    AND org_id = public.current_org_id()
  );

CREATE POLICY "csv_imports_admin_delete"
  ON public.csv_imports
  FOR DELETE
  USING (
    public.current_user_role() = 'admin'
    AND org_id = public.current_org_id()
  );

-- =============================================================================
-- RLS Policies: import_rows — access via parent csv_imports row (org-scoped)
-- Admins may access import_rows only when the parent csv_import belongs to their org
-- =============================================================================

CREATE POLICY "import_rows_admin_select"
  ON public.import_rows
  FOR SELECT
  USING (
    public.current_user_role() = 'admin'
    AND EXISTS (
      SELECT 1 FROM public.csv_imports ci
      WHERE ci.id = import_id
        AND ci.org_id = public.current_org_id()
    )
  );

CREATE POLICY "import_rows_admin_insert"
  ON public.import_rows
  FOR INSERT
  WITH CHECK (
    public.current_user_role() = 'admin'
    AND EXISTS (
      SELECT 1 FROM public.csv_imports ci
      WHERE ci.id = import_id
        AND ci.org_id = public.current_org_id()
    )
  );

CREATE POLICY "import_rows_admin_update"
  ON public.import_rows
  FOR UPDATE
  USING (
    public.current_user_role() = 'admin'
    AND EXISTS (
      SELECT 1 FROM public.csv_imports ci
      WHERE ci.id = import_id
        AND ci.org_id = public.current_org_id()
    )
  )
  WITH CHECK (
    public.current_user_role() = 'admin'
    AND EXISTS (
      SELECT 1 FROM public.csv_imports ci
      WHERE ci.id = import_id
        AND ci.org_id = public.current_org_id()
    )
  );

CREATE POLICY "import_rows_admin_delete"
  ON public.import_rows
  FOR DELETE
  USING (
    public.current_user_role() = 'admin'
    AND EXISTS (
      SELECT 1 FROM public.csv_imports ci
      WHERE ci.id = import_id
        AND ci.org_id = public.current_org_id()
    )
  );

-- =============================================================================
-- RLS Policies: phantom_rooms — admin-only, org-scoped
-- =============================================================================

CREATE POLICY "phantom_rooms_admin_select"
  ON public.phantom_rooms
  FOR SELECT
  USING (
    public.current_user_role() = 'admin'
    AND org_id = public.current_org_id()
  );

CREATE POLICY "phantom_rooms_admin_insert"
  ON public.phantom_rooms
  FOR INSERT
  WITH CHECK (
    public.current_user_role() = 'admin'
    AND org_id = public.current_org_id()
  );

CREATE POLICY "phantom_rooms_admin_update"
  ON public.phantom_rooms
  FOR UPDATE
  USING (
    public.current_user_role() = 'admin'
    AND org_id = public.current_org_id()
  )
  WITH CHECK (
    public.current_user_role() = 'admin'
    AND org_id = public.current_org_id()
  );

CREATE POLICY "phantom_rooms_admin_delete"
  ON public.phantom_rooms
  FOR DELETE
  USING (
    public.current_user_role() = 'admin'
    AND org_id = public.current_org_id()
  );

-- =============================================================================
-- RLS Policies: property_mappings — admin-only, org-scoped
-- =============================================================================

CREATE POLICY "property_mappings_admin_select"
  ON public.property_mappings
  FOR SELECT
  USING (
    public.current_user_role() = 'admin'
    AND org_id = public.current_org_id()
  );

CREATE POLICY "property_mappings_admin_insert"
  ON public.property_mappings
  FOR INSERT
  WITH CHECK (
    public.current_user_role() = 'admin'
    AND org_id = public.current_org_id()
  );

CREATE POLICY "property_mappings_admin_update"
  ON public.property_mappings
  FOR UPDATE
  USING (
    public.current_user_role() = 'admin'
    AND org_id = public.current_org_id()
  )
  WITH CHECK (
    public.current_user_role() = 'admin'
    AND org_id = public.current_org_id()
  );

CREATE POLICY "property_mappings_admin_delete"
  ON public.property_mappings
  FOR DELETE
  USING (
    public.current_user_role() = 'admin'
    AND org_id = public.current_org_id()
  );

-- =============================================================================
-- RLS Policies: account_mappings — admin-only, org-scoped
-- =============================================================================

CREATE POLICY "account_mappings_admin_select"
  ON public.account_mappings
  FOR SELECT
  USING (
    public.current_user_role() = 'admin'
    AND org_id = public.current_org_id()
  );

CREATE POLICY "account_mappings_admin_insert"
  ON public.account_mappings
  FOR INSERT
  WITH CHECK (
    public.current_user_role() = 'admin'
    AND org_id = public.current_org_id()
  );

CREATE POLICY "account_mappings_admin_update"
  ON public.account_mappings
  FOR UPDATE
  USING (
    public.current_user_role() = 'admin'
    AND org_id = public.current_org_id()
  )
  WITH CHECK (
    public.current_user_role() = 'admin'
    AND org_id = public.current_org_id()
  );

CREATE POLICY "account_mappings_admin_delete"
  ON public.account_mappings
  FOR DELETE
  USING (
    public.current_user_role() = 'admin'
    AND org_id = public.current_org_id()
  );
