-- =============================================================================
-- Baseline migration: PropFlow → Fly.io Postgres + Drizzle ORM
--
-- This file creates all tables from scratch for a fresh Fly.io Postgres instance.
-- Supabase-specific features (auth.users, RLS, pg_net) are NOT included.
-- Tenant isolation is enforced at the application layer (WHERE org_id = ?).
--
-- Run with: npx drizzle-kit migrate   OR   psql $DATABASE_URL < this_file
-- =============================================================================

-- Enable pgcrypto for gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =============================================================================
-- NextAuth tables (required by @auth/drizzle-adapter)
-- =============================================================================

CREATE TABLE IF NOT EXISTS "users" (
  "id"             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "name"           TEXT,
  "email"          TEXT UNIQUE,
  "email_verified" TIMESTAMPTZ,
  "image"          TEXT,
  "password_hash"  TEXT   -- bcrypt hash for Credentials provider; NULL for OAuth users
);

CREATE TABLE IF NOT EXISTS "accounts" (
  "user_id"              UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "type"                 TEXT NOT NULL,
  "provider"             TEXT NOT NULL,
  "provider_account_id"  TEXT NOT NULL,
  "refresh_token"        TEXT,
  "access_token"         TEXT,
  "expires_at"           INTEGER,
  "token_type"           TEXT,
  "scope"                TEXT,
  "id_token"             TEXT,
  "session_state"        TEXT,
  PRIMARY KEY ("provider", "provider_account_id")
);

CREATE TABLE IF NOT EXISTS "sessions" (
  "session_token" TEXT PRIMARY KEY,
  "user_id"       UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "expires"       TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS "verification_tokens" (
  "identifier" TEXT NOT NULL,
  "token"      TEXT NOT NULL,
  "expires"    TIMESTAMPTZ NOT NULL,
  PRIMARY KEY ("identifier", "token")
);

-- =============================================================================
-- Domain table 1: organizations
-- =============================================================================

CREATE TABLE IF NOT EXISTS "organizations" (
  "id"         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "name"       TEXT NOT NULL,
  "slug"       TEXT UNIQUE,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- Domain table 2: profiles
-- Key change: user_id FK → users.id (replaces old profiles.id → auth.users(id))
-- =============================================================================

CREATE TABLE IF NOT EXISTS "profiles" (
  "id"                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id"             UUID UNIQUE REFERENCES "users"("id") ON DELETE CASCADE,
  "org_id"              UUID NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "role"                TEXT NOT NULL CHECK (role IN ('admin', 'tenant')),
  "full_name"           TEXT,
  "email"               TEXT,
  "phone"               TEXT,
  "preferred_language"  TEXT CHECK (preferred_language IN ('es', 'en', 'pt')),
  "terms_accepted_at"   TIMESTAMPTZ,
  "terms_version"       TEXT,
  "privacy_accepted_at" TIMESTAMPTZ,
  "privacy_version"     TEXT,
  "created_at"          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at"          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_profiles_org_id   ON "profiles"("org_id");
CREATE INDEX IF NOT EXISTS idx_profiles_org_role ON "profiles"("org_id", "role");

-- =============================================================================
-- Domain table 3: properties
-- =============================================================================

CREATE TABLE IF NOT EXISTS "properties" (
  "id"                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"               UUID NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "name"                 TEXT NOT NULL,
  "address"              TEXT,
  "city"                 TEXT,
  "country"              TEXT,
  "airtable_external_id" TEXT,
  "airtable_synced_at"   TIMESTAMPTZ,
  "tope_luz"             NUMERIC,
  "tope_agua"            NUMERIC,
  "created_at"           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at"           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_properties_org_id ON "properties"("org_id");
CREATE UNIQUE INDEX IF NOT EXISTS properties_org_airtable_uniq ON "properties"("org_id", "airtable_external_id");

-- =============================================================================
-- Domain table 4: units
-- =============================================================================

CREATE TABLE IF NOT EXISTS "units" (
  "id"                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"               UUID NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "property_id"          UUID NOT NULL REFERENCES "properties"("id") ON DELETE CASCADE,
  "label"                TEXT NOT NULL,
  "floor"                TEXT,
  "bedrooms"             INTEGER CHECK (bedrooms >= 0),
  "monthly_rent_default" NUMERIC(12,2) CHECK (monthly_rent_default >= 0),
  "status"               TEXT NOT NULL DEFAULT 'vacant' CHECK (status IN ('vacant', 'occupied')),
  "toilet_type"          TEXT NOT NULL DEFAULT 'private' CHECK (toilet_type IN ('shared', 'private', 'none')),
  "airtable_external_id" TEXT,
  "airtable_synced_at"   TIMESTAMPTZ,
  "area_m2"              NUMERIC,
  "created_at"           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at"           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_units_org_id      ON "units"("org_id");
CREATE INDEX IF NOT EXISTS idx_units_property_id ON "units"("property_id");
CREATE UNIQUE INDEX IF NOT EXISTS units_org_airtable_uniq ON "units"("org_id", "airtable_external_id");

-- =============================================================================
-- Domain table 5: responsables
-- =============================================================================

CREATE TABLE IF NOT EXISTS "responsables" (
  "id"                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"               UUID NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "airtable_external_id" TEXT,
  "airtable_synced_at"   TIMESTAMPTZ,
  "full_name"            TEXT,
  "dni"                  TEXT,
  "phone"                TEXT,
  "email"                TEXT,
  "employment"           TEXT,
  "company"              TEXT,
  "job_title"            TEXT,
  "industry"             TEXT,
  "status"               TEXT,
  "photo_url"            TEXT,
  "created_at"           TIMESTAMPTZ DEFAULT NOW(),
  "updated_at"           TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS responsables_org_airtable_uniq ON "responsables"("org_id", "airtable_external_id");

-- =============================================================================
-- Domain table 6: tenants
-- =============================================================================

CREATE TABLE IF NOT EXISTS "tenants" (
  "id"                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"                 UUID NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "profile_id"             UUID REFERENCES "profiles"("id") ON DELETE SET NULL,
  "responsable_id"         UUID REFERENCES "responsables"("id") ON DELETE SET NULL,
  "full_name"              TEXT NOT NULL,
  "email"                  TEXT,
  "phone"                  TEXT,
  "unit_id"                UUID REFERENCES "units"("id") ON DELETE SET NULL,
  "notes"                  TEXT,
  "preferred_language"     TEXT NOT NULL DEFAULT 'es' CHECK (preferred_language IN ('es', 'en', 'pt')),
  "photo_url"              TEXT,
  "whatsapp_phone"         TEXT,
  "whatsapp_opt_in"        BOOLEAN NOT NULL DEFAULT false,
  "reliability_scores"     JSONB NOT NULL DEFAULT '{}'::jsonb,
  "airtable_external_id"   TEXT,
  "airtable_synced_at"     TIMESTAMPTZ,
  "sync_status"            TEXT NOT NULL DEFAULT 'pending' CHECK (sync_status IN ('pending','synced','failed','needs_review')),
  "last_synced_at"         TIMESTAMPTZ,
  "portal_access"          TEXT NOT NULL DEFAULT 'not_invited' CHECK (portal_access IN ('not_invited','invited','active')),
  "emergency_contact_name" TEXT,
  "emergency_contact_phone" TEXT,
  "external_tenant_id"     TEXT,
  "document_number"        TEXT,
  "date_of_birth"          DATE,
  "move_in_date"           DATE,
  "import_source"          TEXT DEFAULT 'manual',
  "created_at"             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at"             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tenants_org_id     ON "tenants"("org_id");
CREATE INDEX IF NOT EXISTS idx_tenants_org_unit   ON "tenants"("org_id", "unit_id");
CREATE INDEX IF NOT EXISTS idx_tenants_profile_id ON "tenants"("profile_id");
CREATE UNIQUE INDEX IF NOT EXISTS tenants_org_airtable_uniq    ON "tenants"("org_id", "airtable_external_id");
CREATE UNIQUE INDEX IF NOT EXISTS tenants_org_external_id_uidx ON "tenants"("org_id", "external_tenant_id") WHERE external_tenant_id IS NOT NULL;

-- =============================================================================
-- Domain table 7: contracts
-- end_date is nullable (open-ended contracts — migration 052)
-- =============================================================================

CREATE TABLE IF NOT EXISTS "contracts" (
  "id"                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"               UUID NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "tenant_id"            UUID NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "unit_id"              UUID NOT NULL REFERENCES "units"("id") ON DELETE CASCADE,
  "start_date"           DATE NOT NULL,
  "end_date"             DATE,   -- nullable: open-ended contracts
  "monthly_rent"         NUMERIC(12,2) NOT NULL CHECK (monthly_rent > 0),
  "status"               TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'terminated')),
  "deposit"              NUMERIC(12,2) CHECK (deposit >= 0),
  "document_url"         TEXT,
  "signed_at"            TIMESTAMPTZ,
  "signature_status"     TEXT CHECK (signature_status IS NULL OR signature_status IN ('pending_signature','signed','declined')),
  "airtable_external_id" TEXT,
  "airtable_synced_at"   TIMESTAMPTZ,
  "created_at"           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at"           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT contracts_date_order_nullable CHECK (end_date IS NULL OR end_date > start_date)
);

CREATE INDEX IF NOT EXISTS idx_contracts_org_id    ON "contracts"("org_id");
CREATE INDEX IF NOT EXISTS idx_contracts_tenant_id ON "contracts"("tenant_id");
CREATE INDEX IF NOT EXISTS idx_contracts_unit_id   ON "contracts"("unit_id");
CREATE INDEX IF NOT EXISTS idx_contracts_org_status ON "contracts"("org_id", "status");
CREATE UNIQUE INDEX IF NOT EXISTS contracts_org_airtable_uniq ON "contracts"("org_id", "airtable_external_id");

-- =============================================================================
-- Domain table 8: charges
-- =============================================================================

CREATE TABLE IF NOT EXISTS "charges" (
  "id"          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"      UUID NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "contract_id" UUID NOT NULL REFERENCES "contracts"("id") ON DELETE CASCADE,
  "tenant_id"   UUID NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "period"      DATE,
  "description" TEXT,
  "amount"      NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  "due_date"    DATE,
  "created_at"  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at"  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_charges_org_id        ON "charges"("org_id");
CREATE INDEX IF NOT EXISTS idx_charges_contract_id   ON "charges"("contract_id");
CREATE INDEX IF NOT EXISTS idx_charges_tenant_period ON "charges"("tenant_id", "period");

-- =============================================================================
-- Domain table 9: import_logs (referenced by payments.import_id)
-- =============================================================================

CREATE TABLE IF NOT EXISTS "import_logs" (
  "id"                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"                UUID NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "import_type"           TEXT NOT NULL CHECK (import_type IN ('tenant','payment','room_performance','financial')),
  "file_name"             TEXT,
  "imported_by"           UUID REFERENCES "profiles"("id") ON DELETE SET NULL,
  "role"                  TEXT,
  "status"                TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','completed','failed','partial')),
  "rows_received"         INTEGER DEFAULT 0,
  "rows_created"          INTEGER DEFAULT 0,
  "rows_updated"          INTEGER DEFAULT 0,
  "rows_skipped"          INTEGER DEFAULT 0,
  "rows_failed"           INTEGER DEFAULT 0,
  "validation_warnings"   JSONB DEFAULT '[]'::jsonb,
  "error_details"         JSONB DEFAULT '[]'::jsonb,
  "airtable_sync_result"  JSONB,
  "created_at"            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "completed_at"          TIMESTAMPTZ
);

-- =============================================================================
-- Domain table 10: payments
-- =============================================================================

CREATE TABLE IF NOT EXISTS "payments" (
  "id"                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"               UUID NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "contract_id"          UUID NOT NULL REFERENCES "contracts"("id") ON DELETE CASCADE,
  "tenant_id"            UUID NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "amount"               NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  "paid_at"              DATE NOT NULL,
  "method"               TEXT NOT NULL DEFAULT 'transfer' CHECK (method IN ('cash', 'transfer', 'card', 'other')),
  "status"               TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','under_review','rejected')),
  "approved_by"          UUID REFERENCES "profiles"("id") ON DELETE SET NULL,
  "approved_at"          TIMESTAMPTZ,
  "reference"            TEXT,
  "currency"             TEXT NOT NULL DEFAULT 'PEN',
  "receipt_url"          TEXT,
  "movement_type"        TEXT NOT NULL DEFAULT 'payment'
                           CHECK (movement_type IN ('rent_charge','payment','partial_payment','deposit','sanction','discount','adjustment','refund','other')),
  "external_payment_id"  TEXT,
  "import_source"        TEXT DEFAULT 'manual'
                           CHECK (import_source IN ('manual','csv_import','airtable','google_onboarding')),
  "import_id"            UUID REFERENCES "import_logs"("id") ON DELETE SET NULL,
  "airtable_external_id" TEXT,
  "airtable_synced_at"   TIMESTAMPTZ,
  "created_at"           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at"           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payments_org_id      ON "payments"("org_id");
CREATE INDEX IF NOT EXISTS idx_payments_contract_id ON "payments"("contract_id");
CREATE INDEX IF NOT EXISTS idx_payments_tenant_id   ON "payments"("tenant_id");
CREATE INDEX IF NOT EXISTS idx_payments_org_status  ON "payments"("org_id", "status");
CREATE UNIQUE INDEX IF NOT EXISTS payments_org_airtable_uniq   ON "payments"("org_id", "airtable_external_id");
CREATE UNIQUE INDEX IF NOT EXISTS payments_org_external_id_uidx ON "payments"("org_id", "external_payment_id") WHERE external_payment_id IS NOT NULL;

-- =============================================================================
-- Domain table 11: incidents
-- created_by is nullable (Airtable-synced incidents have no creator profile)
-- =============================================================================

CREATE TABLE IF NOT EXISTS "incidents" (
  "id"                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"               UUID NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "unit_id"              UUID REFERENCES "units"("id") ON DELETE SET NULL,
  "property_id"          UUID REFERENCES "properties"("id") ON DELETE SET NULL,
  "created_by"           UUID REFERENCES "profiles"("id") ON DELETE CASCADE,
  "tenant_id"            UUID REFERENCES "tenants"("id") ON DELETE SET NULL,
  "assigned_to"          UUID REFERENCES "profiles"("id") ON DELETE SET NULL,
  "category"             TEXT NOT NULL CHECK (category IN ('plumbing','electrical','appliance','structural','cleaning','other','material_damage','malfunction')),
  "title"                TEXT NOT NULL,
  "description"          TEXT NOT NULL,
  "priority"             TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high','urgent')),
  "status"               TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','in_progress','solved')),
  "photo_path"           TEXT,
  "resolved_at"          TIMESTAMPTZ,
  "cost"                 NUMERIC,
  "airtable_external_id" TEXT,
  "airtable_synced_at"   TIMESTAMPTZ,
  "created_at"           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at"           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_incidents_org_id       ON "incidents"("org_id");
CREATE INDEX IF NOT EXISTS idx_incidents_org_status   ON "incidents"("org_id", "status");
CREATE INDEX IF NOT EXISTS idx_incidents_created_by   ON "incidents"("created_by");
CREATE INDEX IF NOT EXISTS idx_incidents_assigned_to  ON "incidents"("assigned_to");
CREATE UNIQUE INDEX IF NOT EXISTS incidents_org_airtable_uniq ON "incidents"("org_id", "airtable_external_id");

-- =============================================================================
-- Domain table 12: incident_comments
-- =============================================================================

CREATE TABLE IF NOT EXISTS "incident_comments" (
  "id"          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"      UUID NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "incident_id" UUID NOT NULL REFERENCES "incidents"("id") ON DELETE CASCADE,
  "author_id"   UUID NOT NULL REFERENCES "profiles"("id") ON DELETE CASCADE,
  "body"        TEXT NOT NULL CHECK (char_length(body) > 0),
  "created_at"  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at"  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_incident_comments_org_id         ON "incident_comments"("org_id");
CREATE INDEX IF NOT EXISTS idx_incident_comments_incident_time  ON "incident_comments"("incident_id", "created_at");

-- =============================================================================
-- Domain table 13: internal_notes
-- =============================================================================

CREATE TABLE IF NOT EXISTS "internal_notes" (
  "id"         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"     UUID NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "tenant_id"  UUID NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "content"    TEXT NOT NULL,
  "created_by" UUID NOT NULL REFERENCES "profiles"("id") ON DELETE RESTRICT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_internal_notes_tenant ON "internal_notes"("tenant_id", "created_at");
CREATE INDEX IF NOT EXISTS idx_internal_notes_org    ON "internal_notes"("org_id", "created_at");

-- =============================================================================
-- Domain table 14: expense_categories
-- =============================================================================

CREATE TABLE IF NOT EXISTS "expense_categories" (
  "id"         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"     UUID NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "name"       TEXT NOT NULL,
  "color"      TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE ("org_id", "name")
);

CREATE INDEX IF NOT EXISTS idx_expense_categories_org ON "expense_categories"("org_id");

-- =============================================================================
-- Domain table 15: expenses
-- =============================================================================

CREATE TABLE IF NOT EXISTS "expenses" (
  "id"          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"      UUID NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "property_id" UUID REFERENCES "properties"("id") ON DELETE SET NULL,
  "unit_id"     UUID REFERENCES "units"("id") ON DELETE SET NULL,
  "category_id" UUID REFERENCES "expense_categories"("id") ON DELETE SET NULL,
  "amount"      NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  "description" TEXT NOT NULL,
  "incurred_on" DATE NOT NULL,
  "receipt_path" TEXT,
  "created_at"  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at"  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_expenses_org         ON "expenses"("org_id");
CREATE INDEX IF NOT EXISTS idx_expenses_org_date    ON "expenses"("org_id", "incurred_on");
CREATE INDEX IF NOT EXISTS idx_expenses_property    ON "expenses"("property_id");
CREATE INDEX IF NOT EXISTS idx_expenses_category    ON "expenses"("category_id");

-- =============================================================================
-- Domain table 16: receipt_uploads
-- =============================================================================

CREATE TABLE IF NOT EXISTS "receipt_uploads" (
  "id"               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"           UUID NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "payment_id"       UUID REFERENCES "payments"("id") ON DELETE SET NULL,
  "uploaded_by"      UUID NOT NULL REFERENCES "profiles"("id") ON DELETE CASCADE,
  "file_path"        TEXT NOT NULL,
  "ocr_status"       TEXT NOT NULL DEFAULT 'pending' CHECK (ocr_status IN ('pending','processing','extracted','failed','matched')),
  "extracted_amount" NUMERIC(12,2),
  "extracted_date"   DATE,
  "extracted_vendor" TEXT,
  "confidence"       NUMERIC(4,3) CHECK (confidence >= 0 AND confidence <= 1),
  "ocr_error"        TEXT,
  "created_at"       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at"       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_receipt_uploads_org        ON "receipt_uploads"("org_id");
CREATE INDEX IF NOT EXISTS idx_receipt_uploads_org_status ON "receipt_uploads"("org_id", "ocr_status");
CREATE INDEX IF NOT EXISTS idx_receipt_uploads_payment    ON "receipt_uploads"("payment_id");
CREATE INDEX IF NOT EXISTS idx_receipt_uploads_uploader   ON "receipt_uploads"("uploaded_by");

-- =============================================================================
-- Domain table 17: contract_templates
-- =============================================================================

CREATE TABLE IF NOT EXISTS "contract_templates" (
  "id"            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"        UUID NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "name"          TEXT NOT NULL,
  "body_markdown" TEXT NOT NULL,
  "variables"     JSONB NOT NULL DEFAULT '[]',
  "created_at"    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at"    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE ("org_id", "name")
);

CREATE INDEX IF NOT EXISTS idx_contract_templates_org ON "contract_templates"("org_id");

-- =============================================================================
-- Domain table 18: pricing_tables
-- =============================================================================

CREATE TABLE IF NOT EXISTS "pricing_tables" (
  "id"            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"        UUID NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "name"          TEXT NOT NULL,
  "property_type" TEXT NOT NULL,
  "market_zone"   TEXT NOT NULL,
  "tiers"         JSONB NOT NULL DEFAULT '[]',
  "created_at"    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at"    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pricing_tables_org      ON "pricing_tables"("org_id");
CREATE INDEX IF NOT EXISTS idx_pricing_tables_org_type ON "pricing_tables"("org_id", "property_type", "market_zone");

-- =============================================================================
-- Domain table 19: crm_leads
-- =============================================================================

CREATE TABLE IF NOT EXISTS "crm_leads" (
  "id"                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"            UUID NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "full_name"         TEXT NOT NULL,
  "email"             TEXT,
  "phone"             TEXT,
  "property_interest" TEXT,
  "source"            TEXT,
  "status"            TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','contacted','qualified','lost')),
  "notes"             TEXT,
  "created_at"        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at"        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_crm_leads_org        ON "crm_leads"("org_id");
CREATE INDEX IF NOT EXISTS idx_crm_leads_org_status ON "crm_leads"("org_id", "status");

-- =============================================================================
-- Domain table 20: community_posts
-- =============================================================================

CREATE TABLE IF NOT EXISTS "community_posts" (
  "id"         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"     UUID NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "author_id"  UUID NOT NULL REFERENCES "profiles"("id") ON DELETE CASCADE,
  "title"      TEXT NOT NULL,
  "body"       TEXT NOT NULL,
  "category"   TEXT NOT NULL DEFAULT 'general' CHECK (category IN ('general','question','marketplace','event')),
  "pinned"     BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_community_posts_org        ON "community_posts"("org_id");
CREATE INDEX IF NOT EXISTS idx_community_posts_org_pinned ON "community_posts"("org_id", "pinned", "created_at");
CREATE INDEX IF NOT EXISTS idx_community_posts_author     ON "community_posts"("author_id");

-- =============================================================================
-- Domain table 21: community_comments
-- =============================================================================

CREATE TABLE IF NOT EXISTS "community_comments" (
  "id"         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"     UUID NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "post_id"    UUID NOT NULL REFERENCES "community_posts"("id") ON DELETE CASCADE,
  "author_id"  UUID NOT NULL REFERENCES "profiles"("id") ON DELETE CASCADE,
  "body"       TEXT NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_community_comments_org     ON "community_comments"("org_id");
CREATE INDEX IF NOT EXISTS idx_community_comments_post_ts ON "community_comments"("post_id", "created_at");

-- =============================================================================
-- Domain table 22: announcements
-- =============================================================================

CREATE TABLE IF NOT EXISTS "announcements" (
  "id"           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"       UUID NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "created_by"   UUID NOT NULL REFERENCES "profiles"("id") ON DELETE CASCADE,
  "title"        TEXT NOT NULL,
  "body"         TEXT NOT NULL,
  "audience"     TEXT NOT NULL DEFAULT 'all' CHECK (audience IN ('all','property','unit')),
  "property_id"  UUID REFERENCES "properties"("id") ON DELETE SET NULL,
  "unit_id"      UUID REFERENCES "units"("id") ON DELETE SET NULL,
  "published_at" TIMESTAMPTZ,
  "expires_at"   TIMESTAMPTZ,
  "created_at"   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at"   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_announcements_org      ON "announcements"("org_id");
CREATE INDEX IF NOT EXISTS idx_announcements_org_pub  ON "announcements"("org_id", "published_at");
CREATE INDEX IF NOT EXISTS idx_announcements_property ON "announcements"("property_id");
CREATE INDEX IF NOT EXISTS idx_announcements_unit     ON "announcements"("unit_id");

-- =============================================================================
-- Domain table 23: cleaning_tasks
-- =============================================================================

CREATE TABLE IF NOT EXISTS "cleaning_tasks" (
  "id"             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"         UUID NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "unit_id"        UUID REFERENCES "units"("id") ON DELETE SET NULL,
  "assigned_to"    UUID REFERENCES "profiles"("id") ON DELETE SET NULL,
  "title"          TEXT NOT NULL,
  "scheduled_date" DATE NOT NULL,
  "status"         TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','in_progress','done')),
  "notes"          TEXT,
  "completed_at"   TIMESTAMPTZ,
  "created_at"     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at"     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cleaning_tasks_org      ON "cleaning_tasks"("org_id");
CREATE INDEX IF NOT EXISTS idx_cleaning_tasks_org_date ON "cleaning_tasks"("org_id", "scheduled_date");
CREATE INDEX IF NOT EXISTS idx_cleaning_tasks_unit     ON "cleaning_tasks"("unit_id");
CREATE INDEX IF NOT EXISTS idx_cleaning_tasks_assignee ON "cleaning_tasks"("assigned_to");

-- =============================================================================
-- Domain table 24: signature_requests
-- =============================================================================

CREATE TABLE IF NOT EXISTS "signature_requests" (
  "id"                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"               UUID NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "contract_id"          UUID NOT NULL REFERENCES "contracts"("id") ON DELETE CASCADE,
  "signer_profile_id"    UUID REFERENCES "profiles"("id") ON DELETE SET NULL,
  "signer_email"         TEXT NOT NULL,
  "token"                UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  "status"               TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent','viewed','signed','declined','expired')),
  "sent_at"              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "viewed_at"            TIMESTAMPTZ,
  "signed_at"            TIMESTAMPTZ,
  "expires_at"           TIMESTAMPTZ NOT NULL,
  "signature_image_path" TEXT,
  "signed_ip"            INET,
  "signed_user_agent"    TEXT,
  "created_at"           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at"           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_signature_requests_org      ON "signature_requests"("org_id");
CREATE INDEX IF NOT EXISTS idx_signature_requests_contract ON "signature_requests"("contract_id");

-- =============================================================================
-- Domain table 25: reminders
-- =============================================================================

CREATE TABLE IF NOT EXISTS "reminders" (
  "id"              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"          UUID NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "type"            TEXT NOT NULL CHECK (type IN ('lease_renewal','payment_due','custom')),
  "target_type"     TEXT NOT NULL CHECK (target_type IN ('contract','charge','tenant')),
  "target_id"       UUID NOT NULL,
  "channel"         TEXT NOT NULL DEFAULT 'both' CHECK (channel IN ('email','in_app','both')),
  "scheduled_for"   DATE NOT NULL,
  "sent_at"         TIMESTAMPTZ,
  "status"          TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','sent','failed','skipped')),
  "message_preview" TEXT,
  "error"           TEXT,
  "created_at"      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at"      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reminders_org             ON "reminders"("org_id");
CREATE INDEX IF NOT EXISTS idx_reminders_org_date_status ON "reminders"("org_id", "scheduled_for", "status");
CREATE INDEX IF NOT EXISTS idx_reminders_target          ON "reminders"("target_type", "target_id");

-- =============================================================================
-- Domain table 26: notification_inbox
-- =============================================================================

CREATE TABLE IF NOT EXISTS "notification_inbox" (
  "id"           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"       UUID NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "profile_id"   UUID NOT NULL REFERENCES "profiles"("id") ON DELETE CASCADE,
  "type"         TEXT NOT NULL,
  "title"        TEXT NOT NULL,
  "body"         TEXT NOT NULL,
  "related_type" TEXT,
  "related_id"   UUID,
  "read_at"      TIMESTAMPTZ,
  "created_at"   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at"   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notification_inbox_org          ON "notification_inbox"("org_id");
CREATE INDEX IF NOT EXISTS idx_notification_inbox_profile_read ON "notification_inbox"("profile_id", "read_at");
CREATE INDEX IF NOT EXISTS idx_notification_inbox_profile_ts   ON "notification_inbox"("profile_id", "created_at");

-- =============================================================================
-- Domain table 27: visitor_logs
-- =============================================================================

CREATE TABLE IF NOT EXISTS "visitor_logs" (
  "id"             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"         UUID NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "property_id"    UUID REFERENCES "properties"("id") ON DELETE SET NULL,
  "unit_id"        UUID REFERENCES "units"("id") ON DELETE SET NULL,
  "visitor_name"   TEXT NOT NULL,
  "host_tenant_id" UUID REFERENCES "tenants"("id") ON DELETE SET NULL,
  "visit_date"     DATE NOT NULL,
  "entry_time"     TIMESTAMPTZ,
  "exit_time"      TIMESTAMPTZ,
  "purpose"        TEXT,
  "created_by"     UUID NOT NULL REFERENCES "profiles"("id") ON DELETE CASCADE,
  "notes"          TEXT,
  "created_at"     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at"     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_visitor_logs_org      ON "visitor_logs"("org_id");
CREATE INDEX IF NOT EXISTS idx_visitor_logs_org_date ON "visitor_logs"("org_id", "visit_date");
CREATE INDEX IF NOT EXISTS idx_visitor_logs_unit     ON "visitor_logs"("unit_id");
CREATE INDEX IF NOT EXISTS idx_visitor_logs_host     ON "visitor_logs"("host_tenant_id");

-- =============================================================================
-- Domain table 28: ai_chat_messages (immutable — no updated_at)
-- =============================================================================

CREATE TABLE IF NOT EXISTS "ai_chat_messages" (
  "id"         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"     UUID NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "profile_id" UUID NOT NULL REFERENCES "profiles"("id") ON DELETE CASCADE,
  "session_id" UUID NOT NULL,
  "role"       TEXT NOT NULL CHECK (role IN ('user','assistant')),
  "content"    TEXT NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_chat_org         ON "ai_chat_messages"("org_id");
CREATE INDEX IF NOT EXISTS idx_ai_chat_session_ts  ON "ai_chat_messages"("profile_id", "session_id", "created_at");

-- =============================================================================
-- Domain table 29: whatsapp_conversations
-- =============================================================================

CREATE TABLE IF NOT EXISTS "whatsapp_conversations" (
  "id"                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"             UUID NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "tenant_id"          UUID REFERENCES "tenants"("id") ON DELETE SET NULL,
  "external_phone"     TEXT NOT NULL,
  "last_message_at"    TIMESTAMPTZ,
  "unread_count_admin" INTEGER NOT NULL DEFAULT 0,
  "created_at"         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at"         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT whatsapp_conversations_phone_per_org UNIQUE ("org_id", "external_phone")
);

CREATE INDEX IF NOT EXISTS idx_wa_conv_org_last ON "whatsapp_conversations"("org_id", "last_message_at" DESC);
CREATE INDEX IF NOT EXISTS idx_wa_conv_tenant   ON "whatsapp_conversations"("tenant_id") WHERE tenant_id IS NOT NULL;

-- =============================================================================
-- Domain table 30: whatsapp_messages
-- =============================================================================

CREATE TABLE IF NOT EXISTS "whatsapp_messages" (
  "id"                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"              UUID NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "conversation_id"     UUID NOT NULL REFERENCES "whatsapp_conversations"("id") ON DELETE CASCADE,
  "direction"           TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  "provider_message_id" TEXT,
  "body"                TEXT,
  "attachment_path"     TEXT,
  "attachment_kind"     TEXT CHECK (attachment_kind IN ('image', 'document', 'audio', 'video')),
  "classification"      TEXT CHECK (classification IN ('receipt', 'task-proof', 'incident-evidence', 'other')),
  "status"              TEXT NOT NULL DEFAULT 'received' CHECK (status IN ('queued','sent','delivered','read','failed','received')),
  "meta"                JSONB NOT NULL DEFAULT '{}'::jsonb,
  "created_at"          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT whatsapp_messages_provider_id_per_org UNIQUE ("org_id", "provider_message_id") DEFERRABLE INITIALLY DEFERRED
);

CREATE INDEX IF NOT EXISTS idx_wa_msg_conv       ON "whatsapp_messages"("conversation_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS idx_wa_msg_org_status ON "whatsapp_messages"("org_id", "status", "created_at" DESC);

-- =============================================================================
-- Domain table 31: payment_receipts
-- =============================================================================

CREATE TABLE IF NOT EXISTS "payment_receipts" (
  "id"                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"              UUID NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "tenant_id"           UUID NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "source"              TEXT NOT NULL DEFAULT 'whatsapp' CHECK (source IN ('whatsapp', 'manual')),
  "whatsapp_message_id" UUID REFERENCES "whatsapp_messages"("id") ON DELETE SET NULL,
  "image_path"          TEXT NOT NULL,
  "image_sha256"        TEXT NOT NULL,
  "extracted_amount"    NUMERIC(12,2),
  "extracted_date"      DATE,
  "extracted_vendor"    TEXT,
  "confidence"          NUMERIC(4,3),
  "matched_charge_id"   UUID REFERENCES "charges"("id") ON DELETE SET NULL,
  "matched_payment_id"  UUID REFERENCES "payments"("id") ON DELETE SET NULL,
  "status"              TEXT NOT NULL DEFAULT 'pending_review'
                          CHECK (status IN ('pending_review','auto_approved','admin_approved','rejected','duplicate_rejected')),
  "rejection_reason"    TEXT,
  "created_at"          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at"          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT payment_receipts_sha256_per_org UNIQUE ("org_id", "image_sha256")
);

CREATE INDEX IF NOT EXISTS idx_pr_org_status ON "payment_receipts"("org_id", "status", "created_at" DESC);
CREATE INDEX IF NOT EXISTS idx_pr_tenant     ON "payment_receipts"("tenant_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS idx_pr_sha256     ON "payment_receipts"("image_sha256");

-- =============================================================================
-- Domain table 32: airtable_snapshots
-- =============================================================================

CREATE TABLE IF NOT EXISTS "airtable_snapshots" (
  "id"          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"      UUID NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "table_name"  TEXT NOT NULL,
  "external_id" TEXT NOT NULL,
  "data"        JSONB NOT NULL,
  "synced_at"   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT airtable_snapshots_org_table_external_uq UNIQUE ("org_id", "table_name", "external_id")
);

CREATE INDEX IF NOT EXISTS idx_airtable_snapshots_org_table ON "airtable_snapshots"("org_id", "table_name");
CREATE INDEX IF NOT EXISTS idx_airtable_snapshots_synced_at ON "airtable_snapshots"("org_id", "synced_at" DESC);

-- =============================================================================
-- Domain table 33: airtable_sync_logs
-- =============================================================================

CREATE TABLE IF NOT EXISTS "airtable_sync_logs" (
  "id"               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"           UUID NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "table_name"       TEXT NOT NULL,
  "status"           TEXT NOT NULL CHECK (status IN ('success', 'error', 'partial')),
  "records_upserted" INTEGER NOT NULL DEFAULT 0,
  "error_message"    TEXT,
  "started_at"       TIMESTAMPTZ NOT NULL,
  "completed_at"     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_airtable_sync_logs_org_started ON "airtable_sync_logs"("org_id", "started_at" DESC);
CREATE INDEX IF NOT EXISTS idx_airtable_sync_logs_table_name  ON "airtable_sync_logs"("org_id", "table_name");

-- =============================================================================
-- Domain table 34: csv_imports
-- =============================================================================

CREATE TABLE IF NOT EXISTS "csv_imports" (
  "id"                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"            UUID NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "import_type"       TEXT NOT NULL CHECK (import_type IN ('monthly_billed','monthly_collected','monthly_summary','room_performance')),
  "original_filename" TEXT NOT NULL,
  "period"            TEXT NOT NULL,
  "status"            TEXT NOT NULL CHECK (status IN ('dry_run','committed','failed')),
  "row_count"         INTEGER NOT NULL DEFAULT 0,
  "failed_count"      INTEGER NOT NULL DEFAULT 0,
  "error_summary"     JSONB NOT NULL DEFAULT '[]',
  "committed_at"      TIMESTAMPTZ,
  "created_by"        UUID NOT NULL REFERENCES "profiles"("id") ON DELETE RESTRICT,
  "created_at"        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_csv_imports_org_created ON "csv_imports"("org_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS idx_csv_imports_org_status  ON "csv_imports"("org_id", "status");

-- =============================================================================
-- Domain table 35: import_rows
-- =============================================================================

CREATE TABLE IF NOT EXISTS "import_rows" (
  "id"              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "import_id"       UUID NOT NULL REFERENCES "csv_imports"("id") ON DELETE CASCADE,
  "row_number"      INTEGER NOT NULL,
  "raw_data"        JSONB NOT NULL,
  "normalized_data" JSONB,
  "status"          TEXT NOT NULL CHECK (status IN ('ok','warning','error')),
  "error_detail"    TEXT,
  "created_at"      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_import_rows_import_id ON "import_rows"("import_id", "row_number");
CREATE INDEX IF NOT EXISTS idx_import_rows_status    ON "import_rows"("import_id", "status");

-- =============================================================================
-- Domain table 36: account_mappings
-- =============================================================================

CREATE TABLE IF NOT EXISTS "account_mappings" (
  "id"                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"            UUID NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "external_account"  TEXT NOT NULL,
  "internal_category" TEXT,
  "is_income"         BOOLEAN NOT NULL DEFAULT FALSE,
  "affects_net_profit" BOOLEAN NOT NULL DEFAULT TRUE,
  "created_by"        UUID REFERENCES "profiles"("id") ON DELETE SET NULL,
  CONSTRAINT account_mappings_org_account_uq UNIQUE ("org_id", "external_account")
);

CREATE INDEX IF NOT EXISTS idx_account_mappings_org ON "account_mappings"("org_id");

-- =============================================================================
-- Domain table 37: property_mappings
-- =============================================================================

CREATE TABLE IF NOT EXISTS "property_mappings" (
  "id"                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"               UUID NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "external_name"        TEXT NOT NULL,
  "internal_property_id" UUID REFERENCES "properties"("id") ON DELETE SET NULL,
  "last_matched_at"      TIMESTAMPTZ,
  "created_by"           UUID REFERENCES "profiles"("id") ON DELETE SET NULL,
  CONSTRAINT property_mappings_org_name_uq UNIQUE ("org_id", "external_name")
);

CREATE INDEX IF NOT EXISTS idx_property_mappings_org ON "property_mappings"("org_id");

-- =============================================================================
-- Domain table 38: phantom_rooms
-- =============================================================================

CREATE TABLE IF NOT EXISTS "phantom_rooms" (
  "id"              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"          UUID NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "raw_room_label"  TEXT NOT NULL,
  "matched_unit_id" UUID REFERENCES "units"("id") ON DELETE SET NULL,
  "resolution"      TEXT NOT NULL DEFAULT 'pending' CHECK (resolution IN ('pending','mapped','ignored')),
  "resolved_by"     UUID REFERENCES "profiles"("id") ON DELETE SET NULL,
  "resolved_at"     TIMESTAMPTZ,
  "created_at"      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT phantom_rooms_org_label_uq UNIQUE ("org_id", "raw_room_label")
);

CREATE INDEX IF NOT EXISTS idx_phantom_rooms_org_resolution ON "phantom_rooms"("org_id", "resolution");

-- =============================================================================
-- Domain table 39: ai_token_budget
-- =============================================================================

CREATE TABLE IF NOT EXISTS "ai_token_budget" (
  "id"          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"      UUID NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "day"         DATE NOT NULL DEFAULT CURRENT_DATE,
  "tokens_used" INTEGER NOT NULL DEFAULT 0 CHECK (tokens_used >= 0),
  "cost_usd"    NUMERIC(10,4) NOT NULL DEFAULT 0 CHECK (cost_usd >= 0),
  "updated_at"  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_token_budget_org_day ON "ai_token_budget"("org_id", "day");
CREATE INDEX IF NOT EXISTS idx_ai_token_budget_org            ON "ai_token_budget"("org_id", "day" DESC);

-- =============================================================================
-- Domain table 40: unit_images
-- =============================================================================

CREATE TABLE IF NOT EXISTS "unit_images" (
  "id"           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "unit_id"      UUID NOT NULL REFERENCES "units"("id") ON DELETE CASCADE,
  "org_id"       UUID NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "storage_path" TEXT NOT NULL,
  "filename"     TEXT NOT NULL,
  "mime_type"    TEXT NOT NULL,
  "size_bytes"   INTEGER NOT NULL,
  "width"        INTEGER,
  "height"       INTEGER,
  "caption"      TEXT,
  "sort_order"   INTEGER NOT NULL DEFAULT 0,
  "is_cover"     BOOLEAN NOT NULL DEFAULT false,
  "uploaded_by"  UUID REFERENCES "profiles"("id"),
  "created_at"   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_unit_images_unit ON "unit_images"("unit_id", "sort_order");
CREATE INDEX IF NOT EXISTS idx_unit_images_org  ON "unit_images"("org_id");
CREATE UNIQUE INDEX IF NOT EXISTS unit_images_cover_idx ON "unit_images"("unit_id") WHERE is_cover = true;

-- =============================================================================
-- Domain table 41: service_payments
-- =============================================================================

CREATE TABLE IF NOT EXISTS "service_payments" (
  "id"                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"               UUID NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "property_id"          UUID REFERENCES "properties"("id") ON DELETE SET NULL,
  "airtable_external_id" TEXT,
  "airtable_synced_at"   TIMESTAMPTZ,
  "service_type"         TEXT NOT NULL CHECK (service_type IN ('agua','internet','gas','luz','otro')),
  "supply_number"        TEXT,
  "tope"                 NUMERIC,
  "monthly_data"         JSONB,
  "created_at"           TIMESTAMPTZ DEFAULT NOW(),
  "updated_at"           TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS service_payments_org_airtable_uniq ON "service_payments"("org_id", "airtable_external_id");

-- =============================================================================
-- Domain table 42: tenant_invitations
-- =============================================================================

CREATE TABLE IF NOT EXISTS "tenant_invitations" (
  "id"          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"      UUID NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "tenant_id"   UUID NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "email"       TEXT NOT NULL,
  "token_hash"  TEXT NOT NULL,
  "invited_by"  UUID REFERENCES "profiles"("id") ON DELETE SET NULL,
  "status"      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','expired','revoked')),
  "expires_at"  TIMESTAMPTZ NOT NULL,
  "accepted_at" TIMESTAMPTZ,
  "created_at"  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS tenant_invitations_token_hash_uidx ON "tenant_invitations"("token_hash");
CREATE INDEX IF NOT EXISTS tenant_invitations_tenant_idx             ON "tenant_invitations"("tenant_id");

-- =============================================================================
-- Domain table 43: import_logs (defined at table 9 above)
-- Domain table 44: property_weekly_summaries
-- =============================================================================

CREATE TABLE IF NOT EXISTS "property_weekly_summaries" (
  "id"          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"      UUID NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "property_id" UUID NOT NULL REFERENCES "properties"("id") ON DELETE CASCADE,
  "iso_week"    TEXT NOT NULL,
  "body"        TEXT NOT NULL,
  "sent_at"     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE ("property_id", "iso_week")
);

-- =============================================================================
-- Domain table 45: tenant_tasks
-- =============================================================================

CREATE TABLE IF NOT EXISTS "tenant_tasks" (
  "id"               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"           UUID NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "tenant_id"        UUID NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "created_by"       UUID NOT NULL REFERENCES "profiles"("id") ON DELETE RESTRICT,
  "task_type"        TEXT NOT NULL CHECK (task_type IN ('maintenance','document','inspection','cleanup','custom')),
  "title"            TEXT NOT NULL,
  "description"      TEXT,
  "due_at"           TIMESTAMPTZ NOT NULL,
  "reminder_sent_at" TIMESTAMPTZ,
  "status"           TEXT NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending','in_progress','proof_pending_review','completed','expired','cancelled')),
  "completed_at"     TIMESTAMPTZ,
  "created_at"       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at"       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tt_org_status ON "tenant_tasks"("org_id", "status", "due_at");
CREATE INDEX IF NOT EXISTS idx_tt_tenant     ON "tenant_tasks"("tenant_id", "status");
CREATE INDEX IF NOT EXISTS idx_tt_due_at     ON "tenant_tasks"("due_at") WHERE status = 'pending';

-- =============================================================================
-- Domain table 46: task_proofs
-- =============================================================================

CREATE TABLE IF NOT EXISTS "task_proofs" (
  "id"                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"              UUID NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "task_id"             UUID NOT NULL REFERENCES "tenant_tasks"("id") ON DELETE CASCADE,
  "whatsapp_message_id" UUID REFERENCES "whatsapp_messages"("id") ON DELETE SET NULL,
  "image_path"          TEXT NOT NULL,
  "ai_verdict"          TEXT CHECK (ai_verdict IN ('valid','invalid','uncertain')),
  "ai_confidence"       NUMERIC(4,3),
  "admin_decision"      TEXT CHECK (admin_decision IN ('accepted','rejected')),
  "created_at"          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tp_task ON "task_proofs"("task_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS idx_tp_org  ON "task_proofs"("org_id", "created_at" DESC);

-- =============================================================================
-- Domain table 47: sanctions
-- =============================================================================

CREATE TABLE IF NOT EXISTS "sanctions" (
  "id"               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"           UUID NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "tenant_id"        UUID NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "proposed_by"      UUID NOT NULL REFERENCES "profiles"("id") ON DELETE RESTRICT,
  "kind"             TEXT NOT NULL CHECK (kind IN ('monetary','warning')),
  "title"            TEXT NOT NULL,
  "reason"           TEXT NOT NULL,
  "amount"           NUMERIC(12,2),
  "status"           TEXT NOT NULL DEFAULT 'proposed'
                       CHECK (status IN ('proposed','approved','rejected','disputed','resolved')),
  "linked_charge_id" UUID UNIQUE REFERENCES "charges"("id") ON DELETE SET NULL,
  "approved_by"      UUID REFERENCES "profiles"("id") ON DELETE SET NULL,
  "approved_at"      TIMESTAMPTZ,
  "dispute_reason"   TEXT,
  "disputed_at"      TIMESTAMPTZ,
  "resolution_note"  TEXT,
  "resolved_at"      TIMESTAMPTZ,
  "created_at"       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at"       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT sanctions_monetary_amount CHECK (kind <> 'monetary' OR amount IS NOT NULL),
  CONSTRAINT sanctions_warning_no_amount CHECK (kind <> 'warning' OR amount IS NULL)
);

CREATE INDEX IF NOT EXISTS idx_sanctions_org_status ON "sanctions"("org_id", "status", "created_at" DESC);
CREATE INDEX IF NOT EXISTS idx_sanctions_tenant     ON "sanctions"("tenant_id", "created_at" DESC);
