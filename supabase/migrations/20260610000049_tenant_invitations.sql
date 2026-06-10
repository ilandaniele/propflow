-- Migration 000049: tenant_invitations table
-- Supports the tenant portal invitation flow.
-- Raw token is NEVER stored; only sha256 hash is persisted.

CREATE TABLE IF NOT EXISTS tenant_invitations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email       TEXT NOT NULL,
  token_hash  TEXT NOT NULL,           -- sha256 of the raw token; raw token never stored
  invited_by  UUID REFERENCES profiles(id) ON DELETE SET NULL,
  status      TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','accepted','expired','revoked')),
  expires_at  TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS tenant_invitations_token_hash_uidx ON tenant_invitations (token_hash);
CREATE INDEX IF NOT EXISTS tenant_invitations_tenant_idx ON tenant_invitations (tenant_id);

ALTER TABLE tenant_invitations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org members read own invitations" ON tenant_invitations FOR SELECT
  USING (org_id IN (SELECT org_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "service_role full access tenant_invitations" ON tenant_invitations FOR ALL TO service_role
  USING (true) WITH CHECK (true);
