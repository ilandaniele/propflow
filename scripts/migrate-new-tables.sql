-- Migration: Add owners, deposit_accounts, trash_schedules, trash_compliance, absences
-- Run via: flyctl postgres connect --app propflow-db2 < scripts/migrate-new-tables.sql

CREATE TABLE IF NOT EXISTS owners (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  airtable_external_id TEXT,
  airtable_synced_at  TIMESTAMPTZ,
  name                TEXT,
  dni                 TEXT,
  phone               TEXT,
  email               TEXT,
  co_owner_name       TEXT,
  co_owner_dni        TEXT,
  co_owner_phone      TEXT,
  co_owner_email      TEXT,
  mancomunacion       TEXT,
  apoderamiento       TEXT,
  domicilio           TEXT,
  distrito            TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_owners_org ON owners(org_id);
CREATE UNIQUE INDEX IF NOT EXISTS owners_org_airtable_uniq ON owners(org_id, airtable_external_id);

CREATE TABLE IF NOT EXISTS deposit_accounts (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  airtable_external_id TEXT,
  airtable_synced_at  TIMESTAMPTZ,
  name                TEXT,
  banco               TEXT,
  tipo_cuenta         TEXT,
  moneda              TEXT,
  numero_cuenta       TEXT,
  cci                 TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_deposit_accounts_org ON deposit_accounts(org_id);
CREATE UNIQUE INDEX IF NOT EXISTS deposit_accounts_org_airtable_uniq ON deposit_accounts(org_id, airtable_external_id);

CREATE TABLE IF NOT EXISTS trash_schedules (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  airtable_external_id TEXT,
  airtable_synced_at  TIMESTAMPTZ,
  name                TEXT,
  tenant_id           UUID REFERENCES tenants(id) ON DELETE SET NULL,
  unit_id             UUID REFERENCES units(id) ON DELETE SET NULL,
  zona                TEXT,
  dias                TEXT,
  activo              BOOLEAN NOT NULL DEFAULT TRUE,
  turnos_extra        INTEGER,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_trash_schedules_org ON trash_schedules(org_id);
CREATE UNIQUE INDEX IF NOT EXISTS trash_schedules_org_airtable_uniq ON trash_schedules(org_id, airtable_external_id);

CREATE TABLE IF NOT EXISTS trash_compliance (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  airtable_external_id TEXT,
  airtable_synced_at  TIMESTAMPTZ,
  name                TEXT,
  trash_schedule_id   UUID REFERENCES trash_schedules(id) ON DELETE SET NULL,
  tenant_id           UUID REFERENCES tenants(id) ON DELETE SET NULL,
  fecha               DATE,
  estado              TEXT,
  foto_url            TEXT,
  hora_confirmacion   TIMESTAMPTZ,
  hash_imagen         TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_trash_compliance_org ON trash_compliance(org_id);
CREATE UNIQUE INDEX IF NOT EXISTS trash_compliance_org_airtable_uniq ON trash_compliance(org_id, airtable_external_id);

CREATE TABLE IF NOT EXISTS absences (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  airtable_external_id TEXT,
  airtable_synced_at  TIMESTAMPTZ,
  name                TEXT,
  tenant_id           UUID REFERENCES tenants(id) ON DELETE SET NULL,
  fecha_inicio        DATE,
  fecha_fin           DATE,
  estado              TEXT,
  registrado          TIMESTAMPTZ,
  motivo              TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_absences_org ON absences(org_id);
CREATE UNIQUE INDEX IF NOT EXISTS absences_org_airtable_uniq ON absences(org_id, airtable_external_id);

SELECT 'Migration complete: owners, deposit_accounts, trash_schedules, trash_compliance, absences' AS result;
