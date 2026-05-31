-- Migration 000017: WhatsApp tables
-- whatsapp_conversations and whatsapp_messages
-- RLS is applied in migration 000023

CREATE TABLE IF NOT EXISTS public.whatsapp_conversations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  tenant_id       uuid NULL REFERENCES public.tenants(id) ON DELETE SET NULL,
  external_phone  text NOT NULL,           -- E.164, may not match a tenant yet
  last_message_at timestamptz,
  unread_count_admin int NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT whatsapp_conversations_phone_per_org UNIQUE (org_id, external_phone)
);

CREATE INDEX IF NOT EXISTS idx_wa_conv_org_last ON public.whatsapp_conversations (org_id, last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_wa_conv_tenant ON public.whatsapp_conversations (tenant_id) WHERE tenant_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.whatsapp_messages (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  conversation_id     uuid NOT NULL REFERENCES public.whatsapp_conversations(id) ON DELETE CASCADE,
  direction           text NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  provider_message_id text,               -- unique per org for idempotency; PII: do not log
  body                text,               -- PII: never log message body
  attachment_path     text,               -- Supabase storage path
  attachment_kind     text CHECK (attachment_kind IN ('image', 'document', 'audio', 'video')),
  classification      text CHECK (classification IN ('receipt', 'task-proof', 'incident-evidence', 'other')),
  status              text NOT NULL DEFAULT 'received'
                          CHECK (status IN ('queued', 'sent', 'delivered', 'read', 'failed', 'received')),
  meta                jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at          timestamptz NOT NULL DEFAULT now(),

  -- Idempotency: one row per (org, provider_message_id)
  CONSTRAINT whatsapp_messages_provider_id_per_org UNIQUE (org_id, provider_message_id)
    DEFERRABLE INITIALLY DEFERRED
);

CREATE INDEX IF NOT EXISTS idx_wa_msg_conv ON public.whatsapp_messages (conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wa_msg_org_status ON public.whatsapp_messages (org_id, status, created_at DESC);
