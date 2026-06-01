-- Migration 000021: i18n columns
-- Add preferred_language to profiles (admin UI language) and tenants (comms language).
-- Default 'es' (Spanish). Supported: 'es', 'en', 'pt'.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS preferred_language text
    CHECK (preferred_language IN ('es', 'en', 'pt'));

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS preferred_language text NOT NULL DEFAULT 'es'
    CHECK (preferred_language IN ('es', 'en', 'pt'));

COMMENT ON COLUMN public.profiles.preferred_language IS 'Admin UI display language. NULL means auto-detect from Accept-Language, then defaults to es.';
COMMENT ON COLUMN public.tenants.preferred_language IS 'Language used for tenant-facing comms (WhatsApp, email). Independent from admin UI language.';
