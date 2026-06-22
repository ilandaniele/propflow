-- =============================================================================
-- Migration 0002: tenant_statement VIEW
--
-- Computes balance per tenant: approved_payments - charges
-- is_overdue = balance < 0 AND at least one charge has a past due_date
--
-- This is a SQL-only migration (Drizzle does not model VIEWs natively).
-- Apply with: psql $DATABASE_URL -f src/lib/db/migrations/0002_tenant_statement_view.sql
-- =============================================================================

DROP VIEW IF EXISTS tenant_statement;

CREATE VIEW tenant_statement AS
SELECT
  t.id               AS tenant_id,
  t.org_id           AS org_id,
  COALESCE(SUM(ch.amount) FILTER (WHERE ch.id IS NOT NULL), 0)
                     AS total_charges,
  COALESCE(SUM(p.amount) FILTER (WHERE p.id IS NOT NULL AND p.status = 'approved'), 0)
                     AS total_approved_payments,
  COALESCE(SUM(p.amount) FILTER (WHERE p.id IS NOT NULL AND p.status = 'approved'), 0)
    - COALESCE(SUM(ch.amount) FILTER (WHERE ch.id IS NOT NULL), 0)
                     AS balance,
  (
    COALESCE(SUM(p.amount) FILTER (WHERE p.id IS NOT NULL AND p.status = 'approved'), 0)
    - COALESCE(SUM(ch.amount) FILTER (WHERE ch.id IS NOT NULL), 0) < 0
  ) AND EXISTS (
    SELECT 1 FROM charges ch2
    WHERE ch2.tenant_id = t.id
      AND ch2.due_date IS NOT NULL
      AND ch2.due_date < CURRENT_DATE
  )                  AS is_overdue
FROM tenants t
LEFT JOIN charges ch ON ch.tenant_id = t.id
LEFT JOIN payments p  ON p.tenant_id = t.id
GROUP BY t.id, t.org_id;
