-- Migration 000019: tenant_tasks and task_proofs tables
-- tenant_tasks are assigned by admin to a tenant with optional photo proof.
-- RLS is applied in migration 000023.

CREATE TABLE IF NOT EXISTS public.tenant_tasks (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  tenant_id       uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  created_by      uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  task_type       text NOT NULL
                      CHECK (task_type IN (
                        'maintenance', 'document', 'inspection', 'cleanup', 'custom'
                      )),
  title           text NOT NULL,
  description     text,
  due_at          timestamptz NOT NULL,
  reminder_sent_at timestamptz,
  status          text NOT NULL DEFAULT 'pending'
                      CHECK (status IN (
                        'pending',
                        'in_progress',
                        'proof_pending_review',
                        'completed',
                        'expired',
                        'cancelled'
                      )),
  completed_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tt_org_status ON public.tenant_tasks (org_id, status, due_at);
CREATE INDEX IF NOT EXISTS idx_tt_tenant ON public.tenant_tasks (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_tt_due_at ON public.tenant_tasks (due_at) WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS public.task_proofs (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id               uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  task_id              uuid NOT NULL REFERENCES public.tenant_tasks(id) ON DELETE CASCADE,
  whatsapp_message_id  uuid NULL REFERENCES public.whatsapp_messages(id) ON DELETE SET NULL,
  image_path           text NOT NULL,   -- Supabase storage path in 'task-proofs' bucket
  ai_verdict           text CHECK (ai_verdict IN ('valid', 'invalid', 'uncertain')),
  ai_confidence        numeric(4, 3),   -- 0.000–1.000
  admin_decision       text CHECK (admin_decision IN ('accepted', 'rejected')),
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tp_task ON public.task_proofs (task_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tp_org ON public.task_proofs (org_id, created_at DESC);
