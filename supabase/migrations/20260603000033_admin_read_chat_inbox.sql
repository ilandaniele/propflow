-- Migration 20260603000033: Admin SELECT policies for notification_inbox and ai_chat_messages
--
-- Context: The Portal Preview tab on /dashboard/tenants/[id] lets an org admin read
-- notification_inbox and ai_chat_messages rows that belong to tenant profiles in the same org.
-- Previously both tables had only owner-scoped SELECT policies (profile_id = auth.uid()),
-- which blocked admin reads of another profile's rows.
--
-- This is a purely ADDITIVE migration:
--   - No existing policies are dropped or altered.
--   - No schema changes — tables, columns, indexes are unchanged.
--   - Two new FOR SELECT policies are added, one per table.
--
-- Scope guard: both policies check org_id = current_org_id() so an admin from org A
-- CANNOT read rows belonging to org B (cross-org isolation preserved).
--
-- notification_inbox: admin had INSERT (to deliver reminders) but not SELECT.
--   New policy: admin may SELECT any row in their org regardless of profile_id.
--
-- ai_chat_messages: admin had no SELECT access at all (owner-only policy covered FOR ALL
--   only for the owner). New policy: admin may SELECT any row in their org.

-- =============================================================================
-- notification_inbox — admin SELECT
-- =============================================================================

CREATE POLICY "notification_inbox_admin_select"
  ON public.notification_inbox
  FOR SELECT
  USING (
    org_id = public.current_org_id()
    AND public.current_user_role() = 'admin'
  );

-- =============================================================================
-- ai_chat_messages — admin SELECT
-- =============================================================================

CREATE POLICY "ai_chat_messages_admin_select"
  ON public.ai_chat_messages
  FOR SELECT
  USING (
    org_id = public.current_org_id()
    AND public.current_user_role() = 'admin'
  );
