-- Migration 000011: signature_requests + contracts.signature_status CHECK + indexes
-- Phase 2 — Module 2: E-signature workflow

-- ── signature_requests ────────────────────────────────────────────────────────
CREATE TABLE public.signature_requests (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  contract_id           uuid NOT NULL REFERENCES public.contracts(id) ON DELETE CASCADE,
  signer_profile_id     uuid NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  signer_email          text NOT NULL,   -- PII
  token                 uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  status                text NOT NULL DEFAULT 'sent'
                        CHECK (status IN ('sent','viewed','signed','declined','expired')),
  sent_at               timestamptz DEFAULT now() NOT NULL,
  viewed_at             timestamptz NULL,
  signed_at             timestamptz NULL,
  expires_at            timestamptz NOT NULL,
  signature_image_path  text NULL,
  signed_ip             inet NULL,       -- PII
  signed_user_agent     text NULL,
  created_at            timestamptz DEFAULT now() NOT NULL,
  updated_at            timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX idx_signature_requests_org      ON public.signature_requests(org_id);
CREATE INDEX idx_signature_requests_contract ON public.signature_requests(contract_id);
-- token is already UNIQUE (btree) — efficient token lookup

CREATE TRIGGER trg_signature_requests_updated
  BEFORE UPDATE ON public.signature_requests
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── contracts: add CHECK constraint on signature_status ──────────────────────
-- Do NOT change existing columns — only add a constraint (spec: ALTER only).
ALTER TABLE public.contracts
  ADD CONSTRAINT contracts_signature_status_chk
  CHECK (
    signature_status IS NULL
    OR signature_status IN ('pending_signature','signed','declined')
  );
