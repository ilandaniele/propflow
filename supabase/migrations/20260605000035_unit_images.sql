-- Migration 000035: unit_images table + RLS

CREATE TABLE unit_images (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id      UUID        NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  org_id       UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  storage_path TEXT        NOT NULL,
  filename     TEXT        NOT NULL,
  mime_type    TEXT        NOT NULL,
  size_bytes   INTEGER     NOT NULL,
  width        INTEGER,
  height       INTEGER,
  caption      TEXT,
  sort_order   INTEGER     NOT NULL DEFAULT 0,
  is_cover     BOOLEAN     NOT NULL DEFAULT false,
  uploaded_by  UUID        REFERENCES profiles(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_unit_images_unit ON unit_images (unit_id, sort_order);
CREATE INDEX idx_unit_images_org  ON unit_images (org_id);

-- Partial unique index: at most one cover per unit
CREATE UNIQUE INDEX unit_images_cover_idx ON unit_images (unit_id) WHERE is_cover = true;

ALTER TABLE unit_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE unit_images FORCE ROW LEVEL SECURITY;

-- Admin / manager: full access within their org
CREATE POLICY "unit_images_admin_all" ON unit_images
  FOR ALL TO authenticated
  USING (
    org_id IN (
      SELECT org_id FROM profiles
      WHERE id = auth.uid() AND role IN ('admin', 'manager')
    )
  )
  WITH CHECK (
    org_id IN (
      SELECT org_id FROM profiles
      WHERE id = auth.uid() AND role IN ('admin', 'manager')
    )
  );

-- Tenant: SELECT only rows for their assigned unit
CREATE POLICY "unit_images_tenant_select" ON unit_images
  FOR SELECT TO authenticated
  USING (
    unit_id IN (
      SELECT unit_id FROM tenants
      WHERE profile_id = auth.uid() AND unit_id IS NOT NULL
    )
  );
