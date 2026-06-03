-- =============================================================================
-- Migration 028: airtable_snapshots + airtable_sync_logs tables
-- AC7: Sync upserts into airtable_snapshots + writes airtable_sync_logs.
-- AC29 (partial): Both tables have ENABLE + FORCE RLS with WITH CHECK policies.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- airtable_snapshots — caches normalised Airtable records per org
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.airtable_snapshots (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  table_name  TEXT NOT NULL,
  external_id TEXT NOT NULL,
  data        JSONB NOT NULL,
  synced_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT airtable_snapshots_org_table_external_uq
    UNIQUE (org_id, table_name, external_id)
);

-- Indexes for fast lookups by org + table, and for time-ordered queries
CREATE INDEX IF NOT EXISTS idx_airtable_snapshots_org_table
  ON public.airtable_snapshots (org_id, table_name);

CREATE INDEX IF NOT EXISTS idx_airtable_snapshots_synced_at
  ON public.airtable_snapshots (org_id, synced_at DESC);

-- ---------------------------------------------------------------------------
-- airtable_sync_logs — audit trail for each sync run
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.airtable_sync_logs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  table_name        TEXT NOT NULL,
  status            TEXT NOT NULL CHECK (status IN ('success', 'error', 'partial')),
  records_upserted  INT NOT NULL DEFAULT 0,
  error_message     TEXT,
  started_at        TIMESTAMPTZ NOT NULL,
  completed_at      TIMESTAMPTZ
);

-- Index for org-ordered log queries (most recent first)
CREATE INDEX IF NOT EXISTS idx_airtable_sync_logs_org_started
  ON public.airtable_sync_logs (org_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_airtable_sync_logs_table_name
  ON public.airtable_sync_logs (org_id, table_name);

-- ---------------------------------------------------------------------------
-- RLS: ENABLE + FORCE on both tables
-- ---------------------------------------------------------------------------

ALTER TABLE public.airtable_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.airtable_snapshots FORCE ROW LEVEL SECURITY;

ALTER TABLE public.airtable_sync_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.airtable_sync_logs FORCE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- RLS Policies: airtable_snapshots
-- Only admins belonging to the same org may SELECT / INSERT / UPDATE.
-- WITH CHECK ensures inserts and updates cannot write rows for a different org.
-- DELETE is omitted intentionally — snapshots are overwritten via upsert, not deleted.
-- ---------------------------------------------------------------------------

CREATE POLICY "airtable_snapshots_admin_select"
  ON public.airtable_snapshots
  FOR SELECT
  USING (
    public.current_user_role() = 'admin'
    AND org_id = public.current_org_id()
  );

CREATE POLICY "airtable_snapshots_admin_insert"
  ON public.airtable_snapshots
  FOR INSERT
  WITH CHECK (
    public.current_user_role() = 'admin'
    AND org_id = public.current_org_id()
  );

CREATE POLICY "airtable_snapshots_admin_update"
  ON public.airtable_snapshots
  FOR UPDATE
  USING (
    public.current_user_role() = 'admin'
    AND org_id = public.current_org_id()
  )
  WITH CHECK (
    public.current_user_role() = 'admin'
    AND org_id = public.current_org_id()
  );

-- ---------------------------------------------------------------------------
-- RLS Policies: airtable_sync_logs
-- Same pattern: admin-only, org-scoped, WITH CHECK on insert/update.
-- ---------------------------------------------------------------------------

CREATE POLICY "airtable_sync_logs_admin_select"
  ON public.airtable_sync_logs
  FOR SELECT
  USING (
    public.current_user_role() = 'admin'
    AND org_id = public.current_org_id()
  );

CREATE POLICY "airtable_sync_logs_admin_insert"
  ON public.airtable_sync_logs
  FOR INSERT
  WITH CHECK (
    public.current_user_role() = 'admin'
    AND org_id = public.current_org_id()
  );

CREATE POLICY "airtable_sync_logs_admin_update"
  ON public.airtable_sync_logs
  FOR UPDATE
  USING (
    public.current_user_role() = 'admin'
    AND org_id = public.current_org_id()
  )
  WITH CHECK (
    public.current_user_role() = 'admin'
    AND org_id = public.current_org_id()
  );
