-- Migration 20260601000025: Add toilet_type column to units table
-- Existing RLS policies on units (org_id-scoped) cover this new column automatically.

ALTER TABLE public.units
  ADD COLUMN toilet_type TEXT NOT NULL DEFAULT 'private'
  CHECK (toilet_type IN ('shared', 'private', 'none'));

-- Backfill note: DEFAULT 'private' handles all existing rows at ALTER TABLE time.
-- An explicit UPDATE is unnecessary (and would be a no-op), but this comment
-- documents the zero-downtime backfill behaviour for reviewers.
