-- Migration 000015: RLS enable/force/deny-by-default + policies for all 14 Phase 2 tables
-- Follows the proven pattern from migrations 000002–000003

-- ═══════════════════════════════════════════════════════════════════════════════
-- Enable RLS + Force RLS on all 14 new tables (deny-by-default)
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.expense_categories   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expense_categories   FORCE  ROW LEVEL SECURITY;

ALTER TABLE public.expenses             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expenses             FORCE  ROW LEVEL SECURITY;

ALTER TABLE public.receipt_uploads      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.receipt_uploads      FORCE  ROW LEVEL SECURITY;

ALTER TABLE public.contract_templates   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contract_templates   FORCE  ROW LEVEL SECURITY;

ALTER TABLE public.pricing_tables       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pricing_tables       FORCE  ROW LEVEL SECURITY;

ALTER TABLE public.signature_requests   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.signature_requests   FORCE  ROW LEVEL SECURITY;

ALTER TABLE public.announcements        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.announcements        FORCE  ROW LEVEL SECURITY;

ALTER TABLE public.cleaning_tasks       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cleaning_tasks       FORCE  ROW LEVEL SECURITY;

ALTER TABLE public.crm_leads            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_leads            FORCE  ROW LEVEL SECURITY;

ALTER TABLE public.reminders            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reminders            FORCE  ROW LEVEL SECURITY;

ALTER TABLE public.notification_inbox   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_inbox   FORCE  ROW LEVEL SECURITY;

ALTER TABLE public.community_posts      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_posts      FORCE  ROW LEVEL SECURITY;

ALTER TABLE public.community_comments   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_comments   FORCE  ROW LEVEL SECURITY;

ALTER TABLE public.visitor_logs         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.visitor_logs         FORCE  ROW LEVEL SECURITY;

ALTER TABLE public.ai_chat_messages     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_chat_messages     FORCE  ROW LEVEL SECURITY;

-- ═══════════════════════════════════════════════════════════════════════════════
-- Module 1: expense_categories — admin full CRUD in org; tenant: no access
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE POLICY expense_categories_admin_all ON public.expense_categories
  FOR ALL
  USING  (org_id = public.current_org_id() AND public.current_user_role() = 'admin')
  WITH CHECK (org_id = public.current_org_id() AND public.current_user_role() = 'admin');

-- ═══════════════════════════════════════════════════════════════════════════════
-- Module 1: expenses — admin full CRUD; tenant: no access
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE POLICY expenses_admin_all ON public.expenses
  FOR ALL
  USING  (org_id = public.current_org_id() AND public.current_user_role() = 'admin')
  WITH CHECK (org_id = public.current_org_id() AND public.current_user_role() = 'admin');

-- ═══════════════════════════════════════════════════════════════════════════════
-- Module 1: receipt_uploads
--   admin: full CRUD in org
--   tenant: INSERT own (uploaded_by = auth.uid()) + SELECT own uploads
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE POLICY receipt_uploads_admin_all ON public.receipt_uploads
  FOR ALL
  USING  (org_id = public.current_org_id() AND public.current_user_role() = 'admin')
  WITH CHECK (org_id = public.current_org_id() AND public.current_user_role() = 'admin');

CREATE POLICY receipt_uploads_tenant_insert ON public.receipt_uploads
  FOR INSERT
  WITH CHECK (
    org_id = public.current_org_id()
    AND public.current_user_role() = 'tenant'
    AND uploaded_by = auth.uid()
    AND ocr_status = 'pending'
  );

CREATE POLICY receipt_uploads_tenant_select ON public.receipt_uploads
  FOR SELECT
  USING (
    org_id = public.current_org_id()
    AND public.current_user_role() = 'tenant'
    AND uploaded_by = auth.uid()
  );

-- ═══════════════════════════════════════════════════════════════════════════════
-- Module 2: contract_templates — admin full CRUD; tenant: no access
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE POLICY contract_templates_admin_all ON public.contract_templates
  FOR ALL
  USING  (org_id = public.current_org_id() AND public.current_user_role() = 'admin')
  WITH CHECK (org_id = public.current_org_id() AND public.current_user_role() = 'admin');

-- ═══════════════════════════════════════════════════════════════════════════════
-- Module 2: pricing_tables — admin full CRUD; tenant: no access
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE POLICY pricing_tables_admin_all ON public.pricing_tables
  FOR ALL
  USING  (org_id = public.current_org_id() AND public.current_user_role() = 'admin')
  WITH CHECK (org_id = public.current_org_id() AND public.current_user_role() = 'admin');

-- ═══════════════════════════════════════════════════════════════════════════════
-- Module 2: signature_requests
--   admin: full CRUD in org
--   tenant: SELECT own (signer_profile_id = auth.uid())
--   Public sign page reads via service-role Route Handler (bypasses RLS correctly)
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE POLICY signature_requests_admin_all ON public.signature_requests
  FOR ALL
  USING  (org_id = public.current_org_id() AND public.current_user_role() = 'admin')
  WITH CHECK (org_id = public.current_org_id() AND public.current_user_role() = 'admin');

CREATE POLICY signature_requests_tenant_select ON public.signature_requests
  FOR SELECT
  USING (
    org_id = public.current_org_id()
    AND public.current_user_role() = 'tenant'
    AND signer_profile_id = auth.uid()
  );

-- ═══════════════════════════════════════════════════════════════════════════════
-- Module 3: announcements
--   admin: full CRUD in org
--   tenant: SELECT only published, non-expired announcements targeting their unit/property
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE POLICY announcements_admin_all ON public.announcements
  FOR ALL
  USING  (org_id = public.current_org_id() AND public.current_user_role() = 'admin')
  WITH CHECK (org_id = public.current_org_id() AND public.current_user_role() = 'admin');

CREATE POLICY announcements_tenant_select ON public.announcements
  FOR SELECT
  USING (
    org_id = public.current_org_id()
    AND public.current_user_role() = 'tenant'
    AND published_at IS NOT NULL
    AND published_at <= now()
    AND (expires_at IS NULL OR expires_at > now())
    AND (
      audience = 'all'
      OR (
        audience = 'property'
        AND property_id IN (
          SELECT u.property_id FROM public.units u
          JOIN public.contracts c ON c.unit_id = u.id
          JOIN public.tenants t ON t.id = c.tenant_id
          WHERE t.profile_id = auth.uid()
            AND c.status = 'active'
        )
      )
      OR (
        audience = 'unit'
        AND unit_id IN (
          SELECT c.unit_id FROM public.contracts c
          JOIN public.tenants t ON t.id = c.tenant_id
          WHERE t.profile_id = auth.uid()
            AND c.status = 'active'
        )
      )
    )
  );

-- ═══════════════════════════════════════════════════════════════════════════════
-- Module 3: cleaning_tasks — admin full CRUD; tenant: no access (internal ops)
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE POLICY cleaning_tasks_admin_all ON public.cleaning_tasks
  FOR ALL
  USING  (org_id = public.current_org_id() AND public.current_user_role() = 'admin')
  WITH CHECK (org_id = public.current_org_id() AND public.current_user_role() = 'admin');

-- ═══════════════════════════════════════════════════════════════════════════════
-- Module 3: crm_leads — admin full CRUD; tenant: no access
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE POLICY crm_leads_admin_all ON public.crm_leads
  FOR ALL
  USING  (org_id = public.current_org_id() AND public.current_user_role() = 'admin')
  WITH CHECK (org_id = public.current_org_id() AND public.current_user_role() = 'admin');

-- ═══════════════════════════════════════════════════════════════════════════════
-- Module 3: reminders — admin full CRUD; tenant: no access (output is inbox)
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE POLICY reminders_admin_all ON public.reminders
  FOR ALL
  USING  (org_id = public.current_org_id() AND public.current_user_role() = 'admin')
  WITH CHECK (org_id = public.current_org_id() AND public.current_user_role() = 'admin');

-- ═══════════════════════════════════════════════════════════════════════════════
-- Module 3: notification_inbox — owner-scoped
--   SELECT/UPDATE: profile_id = auth.uid() AND org_id = current_org_id()
--   INSERT: admin may insert for any profile in their org (cron uses service-role)
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE POLICY notification_inbox_admin_insert ON public.notification_inbox
  FOR INSERT
  WITH CHECK (org_id = public.current_org_id() AND public.current_user_role() = 'admin');

CREATE POLICY notification_inbox_owner_select ON public.notification_inbox
  FOR SELECT
  USING (
    org_id = public.current_org_id()
    AND profile_id = auth.uid()
  );

CREATE POLICY notification_inbox_owner_update ON public.notification_inbox
  FOR UPDATE
  USING (
    org_id = public.current_org_id()
    AND profile_id = auth.uid()
  )
  WITH CHECK (
    org_id = public.current_org_id()
    AND profile_id = auth.uid()
  );

-- ═══════════════════════════════════════════════════════════════════════════════
-- Module 4: community_posts
--   admin: full CRUD in org (including set pinned)
--   tenant: SELECT all org posts; INSERT own (author_id = auth.uid(), pinned=false enforced);
--           UPDATE own non-pinned posts (body/title only — pinned is NOT updatable by tenant)
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE POLICY community_posts_admin_all ON public.community_posts
  FOR ALL
  USING  (org_id = public.current_org_id() AND public.current_user_role() = 'admin')
  WITH CHECK (org_id = public.current_org_id() AND public.current_user_role() = 'admin');

CREATE POLICY community_posts_tenant_select ON public.community_posts
  FOR SELECT
  USING (
    org_id = public.current_org_id()
    AND public.current_user_role() = 'tenant'
  );

CREATE POLICY community_posts_tenant_insert ON public.community_posts
  FOR INSERT
  WITH CHECK (
    org_id = public.current_org_id()
    AND public.current_user_role() = 'tenant'
    AND author_id = auth.uid()
    AND pinned = false
  );

CREATE POLICY community_posts_tenant_update ON public.community_posts
  FOR UPDATE
  USING (
    org_id = public.current_org_id()
    AND public.current_user_role() = 'tenant'
    AND author_id = auth.uid()
    AND pinned = false
  )
  WITH CHECK (
    org_id = public.current_org_id()
    AND public.current_user_role() = 'tenant'
    AND author_id = auth.uid()
    AND pinned = false   -- tenant cannot flip pinned to true
  );

-- ═══════════════════════════════════════════════════════════════════════════════
-- Module 4: community_comments
--   admin: full CRUD; tenant: SELECT on org posts; INSERT own
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE POLICY community_comments_admin_all ON public.community_comments
  FOR ALL
  USING  (org_id = public.current_org_id() AND public.current_user_role() = 'admin')
  WITH CHECK (org_id = public.current_org_id() AND public.current_user_role() = 'admin');

CREATE POLICY community_comments_tenant_select ON public.community_comments
  FOR SELECT
  USING (
    org_id = public.current_org_id()
    AND public.current_user_role() = 'tenant'
  );

CREATE POLICY community_comments_tenant_insert ON public.community_comments
  FOR INSERT
  WITH CHECK (
    org_id = public.current_org_id()
    AND public.current_user_role() = 'tenant'
    AND author_id = auth.uid()
  );

-- ═══════════════════════════════════════════════════════════════════════════════
-- Module 4: visitor_logs
--   admin: full CRUD in org
--   tenant: INSERT for their own unit (host/unit validated in action layer too)
--           SELECT visits for their own unit
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE POLICY visitor_logs_admin_all ON public.visitor_logs
  FOR ALL
  USING  (org_id = public.current_org_id() AND public.current_user_role() = 'admin')
  WITH CHECK (org_id = public.current_org_id() AND public.current_user_role() = 'admin');

CREATE POLICY visitor_logs_tenant_insert ON public.visitor_logs
  FOR INSERT
  WITH CHECK (
    org_id = public.current_org_id()
    AND public.current_user_role() = 'tenant'
    AND created_by = auth.uid()
    -- unit must belong to the tenant's active contract
    AND unit_id IN (
      SELECT c.unit_id FROM public.contracts c
      JOIN public.tenants t ON t.id = c.tenant_id
      WHERE t.profile_id = auth.uid()
        AND c.status = 'active'
        AND c.org_id = public.current_org_id()
    )
  );

CREATE POLICY visitor_logs_tenant_select ON public.visitor_logs
  FOR SELECT
  USING (
    org_id = public.current_org_id()
    AND public.current_user_role() = 'tenant'
    AND unit_id IN (
      SELECT c.unit_id FROM public.contracts c
      JOIN public.tenants t ON t.id = c.tenant_id
      WHERE t.profile_id = auth.uid()
        AND c.status = 'active'
        AND c.org_id = public.current_org_id()
    )
  );

-- ═══════════════════════════════════════════════════════════════════════════════
-- Module 4: ai_chat_messages — owner-scoped
--   SELECT/INSERT: profile_id = auth.uid() AND org_id = current_org_id()
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE POLICY ai_chat_messages_owner ON public.ai_chat_messages
  FOR ALL
  USING (
    org_id = public.current_org_id()
    AND profile_id = auth.uid()
  )
  WITH CHECK (
    org_id = public.current_org_id()
    AND profile_id = auth.uid()
  );
