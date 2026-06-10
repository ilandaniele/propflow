-- tenants: add sync tracking, portal access, emergency contact, preferred language
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS sync_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (sync_status IN ('pending','synced','failed','needs_review')),
  ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS portal_access TEXT NOT NULL DEFAULT 'not_invited'
    CHECK (portal_access IN ('not_invited','invited','active')),
  ADD COLUMN IF NOT EXISTS emergency_contact_name TEXT,
  ADD COLUMN IF NOT EXISTS emergency_contact_phone TEXT,
  ADD COLUMN IF NOT EXISTS preferred_language TEXT DEFAULT 'es';
