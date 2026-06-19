-- Migration 000055: Add tables for missing Airtable tables:
-- Adicionales → additional_charges
-- EECC → account_statements
-- Impuestos / Comprobantes → tax_receipts
-- Feedback → tenant_feedback
-- Conceptos → charge_concepts (lookup)

-- =============================================================================
-- charge_concepts (Conceptos): lookup table for additional charge types
-- =============================================================================
CREATE TABLE IF NOT EXISTS "public"."charge_concepts" (
  "id"                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"              UUID NOT NULL REFERENCES "public"."organizations"("id") ON DELETE CASCADE,
  "airtable_external_id" TEXT,
  "airtable_synced_at"  TIMESTAMPTZ,
  "code"                TEXT,
  "description"         TEXT NOT NULL,
  "tipo"                TEXT,
  "base_amount"         NUMERIC(12,2),
  "notes"               TEXT,
  "created_at"          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at"          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_charge_concepts_airtable
  ON "public"."charge_concepts" (org_id, airtable_external_id);
CREATE INDEX IF NOT EXISTS idx_charge_concepts_org
  ON "public"."charge_concepts" (org_id);

-- =============================================================================
-- additional_charges (Adicionales): extra charges per contract per month
-- =============================================================================
CREATE TABLE IF NOT EXISTS "public"."additional_charges" (
  "id"                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"              UUID NOT NULL REFERENCES "public"."organizations"("id") ON DELETE CASCADE,
  "airtable_external_id" TEXT,
  "airtable_synced_at"  TIMESTAMPTZ,
  "contract_id"         UUID REFERENCES "public"."contracts"("id") ON DELETE SET NULL,
  "concept_id"          UUID REFERENCES "public"."charge_concepts"("id") ON DELETE SET NULL,
  "mes"                 TEXT,
  "anio"                INTEGER,
  "amount"              NUMERIC(12,2) NOT NULL,
  "description"         TEXT,
  "numero"              INTEGER,
  "created_at"          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at"          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_additional_charges_airtable
  ON "public"."additional_charges" (org_id, airtable_external_id);
CREATE INDEX IF NOT EXISTS idx_additional_charges_org
  ON "public"."additional_charges" (org_id);
CREATE INDEX IF NOT EXISTS idx_additional_charges_contract
  ON "public"."additional_charges" (contract_id);

-- =============================================================================
-- account_statements (EECC): monthly billing statements sent to tenants
-- =============================================================================
CREATE TABLE IF NOT EXISTS "public"."account_statements" (
  "id"                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"                 UUID NOT NULL REFERENCES "public"."organizations"("id") ON DELETE CASCADE,
  "airtable_external_id"   TEXT,
  "airtable_synced_at"     TIMESTAMPTZ,
  "contract_id"            UUID REFERENCES "public"."contracts"("id") ON DELETE SET NULL,
  "eecc_code"              TEXT,
  "mes"                    TEXT,
  "anio"                   INTEGER,
  "issue_date"             DATE,
  "due_date"               DATE,
  "rent_amount"            NUMERIC(12,2),
  "additional_subtotal"    NUMERIC(12,2),
  "previous_rent_balance"  NUMERIC(12,2),
  "previous_addl_balance"  NUMERIC(12,2),
  "total_due"              NUMERIC(12,2),
  "send_status"            TEXT,
  "send_date"              DATE,
  "pdf_url"                TEXT,
  "whatsapp_message_id"    TEXT,
  "send_error"             TEXT,
  "created_at"             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at"             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_account_statements_airtable
  ON "public"."account_statements" (org_id, airtable_external_id);
CREATE INDEX IF NOT EXISTS idx_account_statements_org
  ON "public"."account_statements" (org_id);
CREATE INDEX IF NOT EXISTS idx_account_statements_contract
  ON "public"."account_statements" (contract_id);
CREATE INDEX IF NOT EXISTS idx_account_statements_date
  ON "public"."account_statements" (org_id, anio DESC, mes);

-- =============================================================================
-- tax_receipts (Impuestos / Comprobantes): invoices and receipts per contract
-- =============================================================================
CREATE TABLE IF NOT EXISTS "public"."tax_receipts" (
  "id"                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"              UUID NOT NULL REFERENCES "public"."organizations"("id") ON DELETE CASCADE,
  "airtable_external_id" TEXT,
  "airtable_synced_at"  TIMESTAMPTZ,
  "contract_id"         UUID REFERENCES "public"."contracts"("id") ON DELETE SET NULL,
  "receipt_code"        TEXT,
  "tipo"                TEXT,
  "numero"              TEXT,
  "mes"                 TEXT,
  "anio"                INTEGER,
  "issue_date"          DATE,
  "base_amount"         NUMERIC(12,2),
  "includes_igv"        BOOLEAN DEFAULT FALSE,
  "igv_amount"          NUMERIC(12,2),
  "total_amount"        NUMERIC(12,2),
  "status"              TEXT,
  "file_url"            TEXT,
  "created_at"          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at"          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_tax_receipts_airtable
  ON "public"."tax_receipts" (org_id, airtable_external_id);
CREATE INDEX IF NOT EXISTS idx_tax_receipts_org
  ON "public"."tax_receipts" (org_id);
CREATE INDEX IF NOT EXISTS idx_tax_receipts_contract
  ON "public"."tax_receipts" (contract_id);

-- =============================================================================
-- tenant_feedback (Feedback): satisfaction surveys per tenant per period
-- =============================================================================
CREATE TABLE IF NOT EXISTS "public"."tenant_feedback" (
  "id"                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"                UUID NOT NULL REFERENCES "public"."organizations"("id") ON DELETE CASCADE,
  "airtable_external_id"  TEXT,
  "airtable_synced_at"    TIMESTAMPTZ,
  "tenant_id"             UUID REFERENCES "public"."tenants"("id") ON DELETE SET NULL,
  "fecha"                 DATE,
  "cleaning_score"        INTEGER CHECK (cleaning_score BETWEEN 1 AND 5),
  "coexistence_score"     INTEGER CHECK (coexistence_score BETWEEN 1 AND 5),
  "attention_score"       INTEGER CHECK (attention_score BETWEEN 1 AND 5),
  "security_score"        INTEGER CHECK (security_score BETWEEN 1 AND 5),
  "value_score"           INTEGER CHECK (value_score BETWEEN 1 AND 5),
  "would_recommend"       BOOLEAN,
  "comment"               TEXT,
  "worst_experience"      TEXT,
  "created_at"            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at"            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_tenant_feedback_airtable
  ON "public"."tenant_feedback" (org_id, airtable_external_id);
CREATE INDEX IF NOT EXISTS idx_tenant_feedback_org
  ON "public"."tenant_feedback" (org_id);
CREATE INDEX IF NOT EXISTS idx_tenant_feedback_tenant
  ON "public"."tenant_feedback" (tenant_id);

-- RLS: enable row-level security (org isolation enforced at app layer via service role)
ALTER TABLE "public"."charge_concepts"    ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."additional_charges" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."account_statements" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."tax_receipts"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."tenant_feedback"    ENABLE ROW LEVEL SECURITY;
