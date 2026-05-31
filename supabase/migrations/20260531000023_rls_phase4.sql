-- Migration 000023: RLS policies for all Phase 4 tables
-- Applies ENABLE + FORCE RLS + deny-by-default + admin org-scoped policies.
-- Tenant policies are scoped to their own rows only.
-- Uses existing current_org_id() and current_user_role() SECURITY DEFINER helpers.

-- =============================================================================
-- whatsapp_conversations
-- =============================================================================

ALTER TABLE public.whatsapp_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_conversations FORCE ROW LEVEL SECURITY;

CREATE POLICY "wa_conv_admin_all" ON public.whatsapp_conversations
  FOR ALL
  USING  (org_id = current_org_id() AND current_user_role() = 'admin')
  WITH CHECK (org_id = current_org_id() AND current_user_role() = 'admin');

-- Tenant: SELECT own conversation only
CREATE POLICY "wa_conv_tenant_select_own" ON public.whatsapp_conversations
  FOR SELECT
  USING (
    current_user_role() = 'tenant'
    AND tenant_id = (SELECT id FROM public.tenants WHERE profile_id = auth.uid() LIMIT 1)
  );

-- =============================================================================
-- whatsapp_messages
-- =============================================================================

ALTER TABLE public.whatsapp_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_messages FORCE ROW LEVEL SECURITY;

CREATE POLICY "wa_msg_admin_all" ON public.whatsapp_messages
  FOR ALL
  USING  (org_id = current_org_id() AND current_user_role() = 'admin')
  WITH CHECK (org_id = current_org_id() AND current_user_role() = 'admin');

-- Tenant: SELECT messages in their own conversation
CREATE POLICY "wa_msg_tenant_select_own" ON public.whatsapp_messages
  FOR SELECT
  USING (
    current_user_role() = 'tenant'
    AND conversation_id IN (
      SELECT id FROM public.whatsapp_conversations
      WHERE tenant_id = (SELECT id FROM public.tenants WHERE profile_id = auth.uid() LIMIT 1)
    )
  );

-- =============================================================================
-- payment_receipts
-- =============================================================================

ALTER TABLE public.payment_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_receipts FORCE ROW LEVEL SECURITY;

CREATE POLICY "pr_admin_all" ON public.payment_receipts
  FOR ALL
  USING  (org_id = current_org_id() AND current_user_role() = 'admin')
  WITH CHECK (org_id = current_org_id() AND current_user_role() = 'admin');

-- Tenant: SELECT their own receipts
CREATE POLICY "pr_tenant_select_own" ON public.payment_receipts
  FOR SELECT
  USING (
    current_user_role() = 'tenant'
    AND tenant_id = (SELECT id FROM public.tenants WHERE profile_id = auth.uid() LIMIT 1)
  );

-- =============================================================================
-- tenant_tasks
-- =============================================================================

ALTER TABLE public.tenant_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_tasks FORCE ROW LEVEL SECURITY;

CREATE POLICY "tt_admin_all" ON public.tenant_tasks
  FOR ALL
  USING  (org_id = current_org_id() AND current_user_role() = 'admin')
  WITH CHECK (org_id = current_org_id() AND current_user_role() = 'admin');

-- Tenant: SELECT their own tasks
CREATE POLICY "tt_tenant_select_own" ON public.tenant_tasks
  FOR SELECT
  USING (
    current_user_role() = 'tenant'
    AND tenant_id = (SELECT id FROM public.tenants WHERE profile_id = auth.uid() LIMIT 1)
  );

-- =============================================================================
-- task_proofs
-- =============================================================================

ALTER TABLE public.task_proofs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_proofs FORCE ROW LEVEL SECURITY;

CREATE POLICY "tp_admin_all" ON public.task_proofs
  FOR ALL
  USING  (org_id = current_org_id() AND current_user_role() = 'admin')
  WITH CHECK (org_id = current_org_id() AND current_user_role() = 'admin');

-- Tenant: SELECT proofs for their own tasks
CREATE POLICY "tp_tenant_select_own" ON public.task_proofs
  FOR SELECT
  USING (
    current_user_role() = 'tenant'
    AND task_id IN (
      SELECT id FROM public.tenant_tasks
      WHERE tenant_id = (SELECT id FROM public.tenants WHERE profile_id = auth.uid() LIMIT 1)
    )
  );

-- =============================================================================
-- sanctions
-- =============================================================================

ALTER TABLE public.sanctions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sanctions FORCE ROW LEVEL SECURITY;

CREATE POLICY "sanctions_admin_all" ON public.sanctions
  FOR ALL
  USING  (org_id = current_org_id() AND current_user_role() = 'admin')
  WITH CHECK (org_id = current_org_id() AND current_user_role() = 'admin');

-- Tenant: SELECT their own sanctions
CREATE POLICY "sanctions_tenant_select_own" ON public.sanctions
  FOR SELECT
  USING (
    current_user_role() = 'tenant'
    AND tenant_id = (SELECT id FROM public.tenants WHERE profile_id = auth.uid() LIMIT 1)
  );

-- Tenant: UPDATE (dispute) their own approved sanction
-- Only specific columns can be updated — enforced via Server Action SECURITY DEFINER pattern;
-- the UPDATE policy here allows the action to run as the tenant user.
CREATE POLICY "sanctions_tenant_dispute_own" ON public.sanctions
  FOR UPDATE
  USING (
    current_user_role() = 'tenant'
    AND tenant_id = (SELECT id FROM public.tenants WHERE profile_id = auth.uid() LIMIT 1)
    AND status = 'approved'
  )
  WITH CHECK (
    current_user_role() = 'tenant'
    AND tenant_id = (SELECT id FROM public.tenants WHERE profile_id = auth.uid() LIMIT 1)
    AND status = 'disputed'
  );

-- =============================================================================
-- internal_notes
-- =============================================================================

ALTER TABLE public.internal_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.internal_notes FORCE ROW LEVEL SECURITY;

-- Admin only — tenant NEVER sees internal notes
CREATE POLICY "internal_notes_admin_all" ON public.internal_notes
  FOR ALL
  USING  (org_id = current_org_id() AND current_user_role() = 'admin')
  WITH CHECK (org_id = current_org_id() AND current_user_role() = 'admin');
