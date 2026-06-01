-- Migration 000022: tenant profile columns for Phase 4
-- Adds photo_url, whatsapp_phone, and reliability_scores (JSONB) to tenants.
-- Also adds whatsapp_opt_in flag for consent-based WhatsApp messaging.

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS photo_url text,
  ADD COLUMN IF NOT EXISTS whatsapp_phone text,           -- E.164 format, e.g. +5491155555555
  ADD COLUMN IF NOT EXISTS whatsapp_opt_in boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS reliability_scores jsonb NOT NULL DEFAULT '{}'::jsonb;

-- reliability_scores JSONB shape:
-- { "on_time": 0-100, "dispute": 0-100, "response": 0-100, "computed_at": "ISO8601" }
-- Computed by src/lib/tenants/reliability.ts, stored here for fast reads on the detail page.

COMMENT ON COLUMN public.tenants.photo_url IS 'Supabase storage path in tenant-avatars bucket. Served as signed URL.';
COMMENT ON COLUMN public.tenants.whatsapp_phone IS 'E.164 WhatsApp number (may differ from voice phone).';
COMMENT ON COLUMN public.tenants.whatsapp_opt_in IS 'Tenant opted in to receive WhatsApp notifications.';
COMMENT ON COLUMN public.tenants.reliability_scores IS 'Computed reliability metrics JSON: {on_time, dispute, response, computed_at}.';

-- internal_notes table (separate from tenants.notes — not visible to tenant)
CREATE TABLE IF NOT EXISTS public.internal_notes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  tenant_id   uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  content     text NOT NULL,
  created_by  uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_internal_notes_tenant ON public.internal_notes (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_internal_notes_org ON public.internal_notes (org_id, created_at DESC);
